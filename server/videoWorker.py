#!/usr/bin/env python3
"""
Dedicated Python FFmpeg background worker for CreatorPilot AI Smart Video Editor.
Handles real ffprobe inspection, lightweight audio extraction for Gemini analysis,
clip trimming, aspect ratio conversion (9:16, 1:1, 16:9), ASS subtitle styling/burn-in,
and progressive MP4 rendering.
"""

import json
import os
import subprocess
import sys
from typing import Any, Dict, List


def emit(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload), flush=True)


def run_ffprobe(input_path: str) -> Dict[str, Any]:
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffprobe failed to inspect video file.")

    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams", [])
    fmt = data.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video_stream:
        raise RuntimeError("No video stream detected in uploaded file.")

    has_audio = any(s.get("codec_type") == "audio" for s in streams)
    width = int(video_stream.get("width") or 1920)
    height = int(video_stream.get("height") or 1080)
    codec = str(video_stream.get("codec_name") or "unknown")

    duration_raw = fmt.get("duration") or video_stream.get("duration") or 0
    duration_sec = round(float(duration_raw), 2)

    return {
        "durationSec": duration_sec,
        "width": width,
        "height": height,
        "codec": codec,
        "hasAudio": has_audio,
    }


def extract_audio(input_path: str, output_path: str) -> None:
    probe = run_ffprobe(input_path)
    if not probe["hasAudio"]:
        emit({"ok": False, "hasAudio": False, "error": "Source video has no audio track."})
        return

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        input_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "48k",
        "-t",
        "900",
        output_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "FFmpeg failed to extract audio.")

    size_bytes = os.path.getsize(output_path) if os.path.exists(output_path) else 0
    emit({"ok": True, "hasAudio": True, "outputPath": output_path, "bytes": size_bytes})


def hex_to_ass_color(hex_color: str, alpha: int = 0) -> str:
    clean = (hex_color or "#FFFFFF").strip().lstrip("#")
    if len(clean) == 3:
        clean = "".join(c * 2 for c in clean)
    if len(clean) != 6:
        clean = "FFFFFF"
    try:
        r = int(clean[0:2], 16)
        g = int(clean[2:4], 16)
        b = int(clean[4:6], 16)
    except ValueError:
        r, g, b = 255, 255, 255
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def format_ass_time(seconds: float) -> str:
    total_cs = max(0, int(round(seconds * 100)))
    hours = total_cs // 360000
    rem = total_cs % 360000
    minutes = rem // 6000
    rem = rem % 6000
    secs = rem // 100
    cs = rem % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


def escape_ass_text(text: str) -> str:
    clean = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    clean = clean.replace("{", "(").replace("}", ")")
    return clean.replace("\n", "\\N")


def escape_ffmpeg_filter_path(file_path: str) -> str:
    # Escape backslashes, colons, and single quotes for FFmpeg filter_complex/vf
    return (
        file_path.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
    )


def build_ass_file(
    ass_path: str,
    width: int,
    height: int,
    clip_start: float,
    clip_end: float,
    subtitles: List[Dict[str, Any]],
    style: Dict[str, Any],
) -> bool:
    font_name = str(style.get("fontFamily") or "DejaVu Sans").replace(",", "")
    base_size = int(style.get("fontSize") or 44)
    scale_factor = width / 1080.0 if width < height else height / 1080.0
    font_size = max(24, min(86, int(round(base_size * max(0.7, scale_factor)))))

    primary_col = hex_to_ass_color(str(style.get("primaryColor") or "#FFFFFF"), 0)
    outline_col = hex_to_ass_color(str(style.get("outlineColor") or "#0F172A"), 0)
    back_col = hex_to_ass_color(str(style.get("backgroundColor") or "#0F172A"), 96)

    position = str(style.get("position") or "bottom").lower()
    if position == "top":
        alignment = 8
        margin_v = int(height * 0.10)
    elif position == "middle":
        alignment = 5
        margin_v = 24
    else:
        alignment = 2
        margin_v = int(height * 0.12)

    uppercase = bool(style.get("uppercase"))
    clip_duration = max(0.5, clip_end - clip_start)

    dialogue_lines: List[str] = []
    for cue in subtitles:
        cue_start = float(cue.get("startSec") or 0)
        cue_end = float(cue.get("endSec") or 0)
        raw_text = str(cue.get("text") or "").strip()
        if not raw_text:
            continue

        # Shift cue timing relative to trimmed clip start if cue falls inside or spans the clip
        if cue_end <= clip_start or cue_start >= clip_end:
            continue

        rel_start = max(0.0, cue_start - clip_start)
        rel_end = min(clip_duration, cue_end - clip_start)
        if rel_end <= rel_start:
            continue

        text = raw_text.upper() if uppercase else raw_text
        dialogue_lines.append(
            f"Dialogue: 0,{format_ass_time(rel_start)},{format_ass_time(rel_end)},Default,,0,0,0,,{escape_ass_text(text)}"
        )

    if not dialogue_lines:
        return False

    header = "\n".join(
        [
            "[Script Info]",
            "ScriptType: v4.00+",
            f"PlayResX: {width}",
            f"PlayResY: {height}",
            "ScaledBorderAndShadow: yes",
            "WrapStyle: 1",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            f"Style: Default,{font_name},{font_size},{primary_col},&H000000FF,{outline_col},{back_col},1,0,0,0,100,100,0,0,1,3,1,{alignment},48,48,{margin_v},1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
            *dialogue_lines,
            "",
        ]
    )

    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(header)

    return True


def render_clip(config_path: str) -> None:
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    input_path = cfg["inputPath"]
    output_path = cfg["outputPath"]
    ass_path = cfg.get("assPath") or f"{os.path.splitext(output_path)[0]}.ass"
    start_sec = max(0.0, float(cfg["startSec"]))
    end_sec = float(cfg["endSec"])
    aspect_ratio = str(cfg.get("aspectRatio") or "9:16")
    subtitles = cfg.get("subtitles") or []
    subtitle_style = cfg.get("subtitleStyle") or {}

    if end_sec <= start_sec:
        raise RuntimeError("Clip end time must be greater than start time.")

    emit({"type": "progress", "progress": 5, "stage": "Inspecting source video streams with ffprobe"})
    probe = run_ffprobe(input_path)
    max_duration = probe["durationSec"] or end_sec
    safe_start = min(start_sec, max(0.0, max_duration - 0.5))
    safe_end = min(end_sec, max_duration) if max_duration > 0 else end_sec
    clip_duration = max(0.5, safe_end - safe_start)

    if aspect_ratio == "1:1":
        target_w, target_h = 1080, 1080
    elif aspect_ratio == "16:9":
        target_w, target_h = 1920, 1080
    else:
        target_w, target_h = 1080, 1920

    emit({"type": "progress", "progress": 12, "stage": f"Preparing {aspect_ratio} filtergraph and subtitle track"})
    has_subtitles = build_ass_file(
        ass_path=ass_path,
        width=target_w,
        height=target_h,
        clip_start=safe_start,
        clip_end=safe_end,
        subtitles=subtitles,
        style=subtitle_style,
    )

    vf_parts = [
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase",
        f"crop={target_w}:{target_h}",
        "setsar=1",
    ]
    if has_subtitles:
        escaped_ass = escape_ffmpeg_filter_path(ass_path)
        vf_parts.append(f"ass='{escaped_ass}'")
    vf_parts.append("format=yuv420p")
    vf_filter = ",".join(vf_parts)

    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{safe_start:.3f}",
        "-i",
        input_path,
        "-t",
        f"{clip_duration:.3f}",
        "-vf",
        vf_filter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
    ]

    if probe["hasAudio"]:
        cmd.extend(["-c:a", "aac", "-b:a", "128k"])
    else:
        cmd.append("-an")

    cmd.extend([
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        output_path,
    ])

    emit({"type": "progress", "progress": 18, "stage": "Encoding MP4 with FFmpeg (libx264 + AAC)"})

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    last_pct = 18
    if proc.stdout is not None:
        for raw_line in proc.stdout:
            line = raw_line.strip()
            if line.startswith("out_time_ms="):
                try:
                    out_ms = int(line.split("=", 1)[1])
                    elapsed_sec = out_ms / 1_000_000.0
                    ratio = min(1.0, max(0.0, elapsed_sec / clip_duration))
                    pct = min(96, max(18, 18 + int(ratio * 78)))
                    if pct > last_pct:
                        last_pct = pct
                        emit({
                            "type": "progress",
                            "progress": pct,
                            "stage": f"Rendering {aspect_ratio} MP4 ({pct}%)",
                        })
                except ValueError:
                    pass

    stderr_output = proc.stderr.read() if proc.stderr is not None else ""
    return_code = proc.wait()
    if return_code != 0:
        tail = "\n".join(stderr_output.strip().splitlines()[-12:])
        raise RuntimeError(f"FFmpeg exited with code {return_code}: {tail}")

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RuntimeError("FFmpeg finished without writing a non-empty MP4 output file.")

    output_bytes = os.path.getsize(output_path)
    emit({
        "type": "done",
        "progress": 100,
        "stage": "MP4 render verified and ready",
        "outputPath": output_path,
        "bytes": output_bytes,
    })


def probe_audio(input_path: str) -> Dict[str, Any]:
    if not os.path.exists(input_path) or os.path.getsize(input_path) == 0:
        raise RuntimeError(f"Audio file missing or empty: {input_path}")
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "ffprobe failed to inspect audio file.")

    data = json.loads(proc.stdout or "{}")
    streams = data.get("streams", [])
    fmt = data.get("format", {})
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not audio_stream:
        raise RuntimeError("No audio stream detected in file.")

    duration_raw = fmt.get("duration") or audio_stream.get("duration") or 0
    return {
        "durationSec": round(float(duration_raw), 3),
        "codec": str(audio_stream.get("codec_name") or "unknown"),
        "sampleRate": int(audio_stream.get("sample_rate") or 24000),
    }


def generate_music_bed(config_path: str) -> None:
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    preset = str(cfg.get("preset") or "ambient-uplift")
    duration_sec = max(5.0, min(120.0, float(cfg.get("durationSec") or 30.0)))
    output_path = str(cfg["outputPath"])

    if preset == "tech-pulse":
        # Clean rhythmic ambient synth pulse (110Hz + 165Hz + 220Hz modulated by 2Hz envelope)
        expr_l = (
            "0.22*sin(2*PI*110*t)*(0.55+0.45*sin(2*PI*2*t))"
            "+0.14*sin(2*PI*220*t)*(0.5+0.5*cos(2*PI*4*t))"
            "+0.10*sin(2*PI*329.63*t)"
        )
        expr_r = (
            "0.22*sin(2*PI*110*t)*(0.55+0.45*cos(2*PI*2*t))"
            "+0.14*sin(2*PI*164.81*t)"
            "+0.10*sin(2*PI*329.63*t)*(0.6+0.4*sin(2*PI*1*t))"
        )
        af = "lowpass=f=1800,aecho=0.8:0.75:60:0.25"
    elif preset == "cinematic-score":
        # Wide atmospheric fifths and warm low drone
        expr_l = (
            "0.24*sin(2*PI*65.41*t)"
            "+0.16*sin(2*PI*130.81*t)"
            "+0.12*sin(2*PI*196.00*t)*(0.65+0.35*sin(2*PI*0.25*t))"
            "+0.08*sin(2*PI*293.66*t)*(0.5+0.5*sin(2*PI*0.18*t))"
        )
        expr_r = (
            "0.24*sin(2*PI*65.41*t)"
            "+0.16*sin(2*PI*130.81*t)"
            "+0.12*sin(2*PI*196.00*t)*(0.65+0.35*cos(2*PI*0.25*t))"
            "+0.08*sin(2*PI*246.94*t)*(0.5+0.5*cos(2*PI*0.2*t))"
        )
        af = "lowpass=f=1400,aecho=0.8:0.85:90:0.3"
    elif preset == "lofi-chill":
        # Warm mellow seventh chord progression
        expr_l = (
            "0.20*sin(2*PI*174.61*t)*(0.7+0.3*sin(2*PI*0.5*t))"
            "+0.14*sin(2*PI*220.00*t)"
            "+0.10*sin(2*PI*261.63*t)"
            "+0.08*sin(2*PI*329.63*t)"
        )
        expr_r = (
            "0.20*sin(2*PI*174.61*t)*(0.7+0.3*cos(2*PI*0.5*t))"
            "+0.14*sin(2*PI*220.00*t)"
            "+0.10*sin(2*PI*261.63*t)"
            "+0.08*sin(2*PI*349.23*t)"
        )
        af = "lowpass=f=1100,aecho=0.7:0.7:50:0.2"
    else:
        # ambient-uplift default: warm uplifting major ninth chord pad
        expr_l = (
            "0.22*sin(2*PI*130.81*t)*(0.7+0.3*sin(2*PI*0.33*t))"
            "+0.15*sin(2*PI*196.00*t)"
            "+0.11*sin(2*PI*246.94*t)"
            "+0.09*sin(2*PI*293.66*t)*(0.6+0.4*sin(2*PI*0.5*t))"
        )
        expr_r = (
            "0.22*sin(2*PI*130.81*t)*(0.7+0.3*cos(2*PI*0.33*t))"
            "+0.15*sin(2*PI*196.00*t)"
            "+0.11*sin(2*PI*246.94*t)"
            "+0.09*sin(2*PI*329.63*t)*(0.6+0.4*cos(2*PI*0.5*t))"
        )
        af = "lowpass=f=1500,aecho=0.8:0.8:70:0.25"

    fade_out_start = max(0.5, duration_sec - 1.5)
    full_af = f"{af},afade=t=in:st=0:d=0.6,afade=t=out:st={fade_out_start:.2f}:d=1.5"

    cmd = [
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        f"aevalsrc={expr_l}|{expr_r}:s=44100:d={duration_sec:.2f}",
        "-af",
        full_af,
        "-c:a",
        "pcm_s16le",
        output_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "Failed to generate music bed.")

    emit({
        "ok": True,
        "outputPath": output_path,
        "bytes": os.path.getsize(output_path),
    })


def format_srt_time(seconds: float) -> str:
    total_ms = max(0, int(round(seconds * 1000)))
    hours = total_ms // 3600000
    rem = total_ms % 3600000
    minutes = rem // 60000
    rem = rem % 60000
    secs = rem // 1000
    ms = rem % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def build_srt_file(srt_path: str, subtitles: List[Dict[str, Any]]) -> None:
    blocks: List[str] = []
    idx = 1
    for cue in subtitles:
        start_sec = float(cue.get("startSec") or 0.0)
        end_sec = float(cue.get("endSec") or 0.0)
        text = str(cue.get("text") or "").strip()
        if not text or end_sec <= start_sec:
            continue
        blocks.append(f"{idx}\n{format_srt_time(start_sec)} --> {format_srt_time(end_sec)}\n{text}\n")
        idx += 1

    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(blocks))


def normalize_scene_clip(
    clip_path: str,
    out_path: str,
    target_w: int,
    target_h: int,
    target_duration: float,
    extra_pad: float,
) -> None:
    if not os.path.exists(clip_path) or os.path.getsize(clip_path) == 0:
        raise RuntimeError(f"Scene clip missing or empty: {clip_path}")

    probe = run_ffprobe(clip_path)
    src_dur = max(0.5, float(probe.get("durationSec") or target_duration))
    desired_dur = max(0.5, target_duration + extra_pad)

    vf_parts = [
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase",
        f"crop={target_w}:{target_h}",
        "setsar=1",
        "fps=30",
        "format=yuv420p",
    ]
    if src_dur < desired_dur:
        pad_dur = max(0.1, desired_dur - src_dur + 0.25)
        vf_parts.append(f"tpad=stop_mode=clone:stop_duration={pad_dur:.3f}")

    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        clip_path,
        "-t",
        f"{desired_dur:.3f}",
        "-vf",
        ",".join(vf_parts),
        "-an",
        "-c:v",
        "libx264",
        "-profile:v",
        "main",
        "-level",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        out_path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-10:])
        raise RuntimeError(f"Failed to normalize scene clip: {tail}")


def compose_ai_video(config_path: str) -> None:
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    work_dir = str(cfg["workDir"])
    output_path = str(cfg["outputPath"])
    ass_path = str(cfg.get("assPath") or os.path.join(work_dir, "subtitles.ass"))
    srt_path = str(cfg.get("srtPath") or os.path.join(work_dir, "subtitles.srt"))
    aspect_ratio = str(cfg.get("aspectRatio") or "9:16")
    scenes = cfg.get("scenes") or []
    subtitles = cfg.get("subtitles") or []
    subtitle_style = cfg.get("subtitleStyle") or {}
    enable_subtitles = bool(cfg.get("enableSubtitles", True))
    narration_volume = max(0.0, min(1.5, float(cfg.get("narrationVolume") if cfg.get("narrationVolume") is not None else 1.0)))
    music_path = str(cfg.get("musicPath") or "")
    music_volume = max(0.0, min(1.0, float(cfg.get("musicVolume") if cfg.get("musicVolume") is not None else 0.22)))

    if not scenes:
        raise RuntimeError("No scene clips provided for video composition.")

    if aspect_ratio == "1:1":
        target_w, target_h = 1080, 1080
    elif aspect_ratio == "16:9":
        target_w, target_h = 1920, 1080
    else:
        target_w, target_h = 1080, 1920

    os.makedirs(work_dir, exist_ok=True)
    fade_overlap = 0.55

    emit({"type": "progress", "progress": 10, "stage": f"Normalizing {len(scenes)} scene clip(s) to {target_w}x{target_h}"})

    scene_count = len(scenes)
    min_scene_dur = min(float(s.get("durationSec") or 5.0) for s in scenes) if scenes else 5.0
    effective_overlap = min(fade_overlap, max(0.25, min_scene_dur * 0.30))
    use_xfade = scene_count > 1 and min_scene_dur >= 1.4

    norm_paths: List[str] = []
    scene_durations: List[float] = []
    for idx, scene in enumerate(scenes):
        dur = max(1.0, float(scene.get("durationSec") or 5.0))
        scene_durations.append(dur)
        # Pad every non-final clip uniformly by effective_overlap so xfade offsets stay locked to audio/subtitles
        extra_pad = effective_overlap if (use_xfade and idx < scene_count - 1) else 0.0
        norm_file = os.path.join(work_dir, f"norm_scene_{idx + 1}.mp4")
        normalize_scene_clip(
            clip_path=str(scene["clipPath"]),
            out_path=norm_file,
            target_w=target_w,
            target_h=target_h,
            target_duration=dur,
            extra_pad=extra_pad,
        )
        norm_paths.append(norm_file)
        pct = 10 + int(((idx + 1) / scene_count) * 35)
        emit({"type": "progress", "progress": pct, "stage": f"Normalized scene {idx + 1}/{scene_count}"})

    total_duration = round(sum(scene_durations), 3)
    concat_video_path = os.path.join(work_dir, "concat_video.mp4")

    emit({"type": "progress", "progress": 50, "stage": "Assembling scene timeline and smooth animated transitions"})

    def run_concat_simple(paths: List[str], durations: List[float], out_file: str) -> None:
        trimmed_args: List[str] = ["ffmpeg", "-y"]
        fc_parts: List[str] = []
        concat_inputs: List[str] = []
        for idx, p in enumerate(paths):
            trimmed_args.extend(["-i", p])
            fc_parts.append(f"[{idx}:v]trim=duration={durations[idx]:.3f},setpts=PTS-STARTPTS[v{idx}]")
            concat_inputs.append(f"[v{idx}]")
        fc_parts.append(f"{''.join(concat_inputs)}concat=n={len(paths)}:v=1:a=0[vout]")
        trimmed_args.extend([
            "-filter_complex",
            ";".join(fc_parts),
            "-map",
            "[vout]",
            "-c:v",
            "libx264",
            "-profile:v",
            "main",
            "-level",
            "4.0",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            out_file,
        ])
        proc = subprocess.run(trimmed_args, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "FFmpeg concat failed.")

    smooth_cycle = [
        "smoothleft",
        "dissolve",
        "smoothup",
        "hblur",
        "smoothright",
        "circleopen",
        "wiperight",
        "fade",
    ]

    if scene_count == 1:
        concat_video_path = norm_paths[0]
    elif use_xfade:
        try:
            cmd = ["ffmpeg", "-y"]
            for p in norm_paths:
                cmd.extend(["-i", p])
            fc_parts = []
            prev_label = "[0:v]"
            cumulative = 0.0
            for idx in range(scene_count - 1):
                cumulative += scene_durations[idx]
                raw_trans = str(scenes[idx].get("transitionType") or "fade").lower()
                if raw_trans == "slideleft":
                    xfade_name = "smoothleft"
                elif raw_trans == "dissolve":
                    xfade_name = "dissolve"
                else:
                    xfade_name = smooth_cycle[idx % len(smooth_cycle)]
                out_label = "[vout]" if idx == scene_count - 2 else f"[vx{idx}]"
                fc_parts.append(
                    f"{prev_label}[{idx + 1}:v]xfade=transition={xfade_name}:duration={effective_overlap:.3f}:offset={cumulative:.3f}{out_label}"
                )
                prev_label = out_label
            cmd.extend([
                "-filter_complex",
                ";".join(fc_parts),
                "-map",
                "[vout]",
                "-t",
                f"{total_duration:.3f}",
                "-c:v",
                "libx264",
                "-profile:v",
                "main",
                "-level",
                "4.0",
                "-pix_fmt",
                "yuv420p",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                concat_video_path,
            ])
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                run_concat_simple(norm_paths, scene_durations, concat_video_path)
        except Exception:
            run_concat_simple(norm_paths, scene_durations, concat_video_path)
    else:
        run_concat_simple(norm_paths, scene_durations, concat_video_path)

    emit({"type": "progress", "progress": 64, "stage": "Synchronizing scene voiceover timeline"})

    # Assemble synchronized narration track aligned to exact scene starts
    narration_entries: List[Dict[str, Any]] = []
    cursor_sec = 0.0
    for idx, scene in enumerate(scenes):
        audio_path = str(scene.get("audioPath") or "")
        if audio_path and os.path.exists(audio_path) and os.path.getsize(audio_path) > 0:
            narration_entries.append({
                "audioPath": audio_path,
                "startMs": int(round(cursor_sec * 1000)),
                "slotDur": scene_durations[idx],
            })
        cursor_sec += scene_durations[idx]

    narration_full_path = os.path.join(work_dir, "narration_full.wav")
    has_narration = len(narration_entries) > 0
    if has_narration:
        narr_cmd = ["ffmpeg", "-y"]
        fc_parts = []
        mix_labels: List[str] = []
        for idx, entry in enumerate(narration_entries):
            narr_cmd.extend(["-i", entry["audioPath"]])
            delay = entry["startMs"]
            fc_parts.append(
                f"[{idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:{entry['slotDur']:.3f},adelay={delay}|{delay}[a{idx}]"
            )
            mix_labels.append(f"[a{idx}]")
        fc_parts.append(
            f"{''.join(mix_labels)}amix=inputs={len(mix_labels)}:duration=longest:normalize=0,apad=whole_dur={total_duration:.3f},atrim=0:{total_duration:.3f}[anarr]"
        )
        narr_cmd.extend([
            "-filter_complex",
            ";".join(fc_parts),
            "-map",
            "[anarr]",
            "-c:a",
            "pcm_s16le",
            narration_full_path,
        ])
        proc = subprocess.run(narr_cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "Failed to synchronize voiceover track.")

    emit({"type": "progress", "progress": 74, "stage": "Preparing subtitles and audio mix"})

    build_srt_file(srt_path=srt_path, subtitles=subtitles)
    has_ass = False
    if enable_subtitles and subtitles:
        has_ass = build_ass_file(
            ass_path=ass_path,
            width=target_w,
            height=target_h,
            clip_start=0.0,
            clip_end=total_duration + 0.5,
            subtitles=subtitles,
            style=subtitle_style,
        )

    has_music = bool(music_path and os.path.exists(music_path) and os.path.getsize(music_path) > 0 and music_volume > 0.0)

    final_cmd = ["ffmpeg", "-y", "-i", concat_video_path]
    input_idx = 1
    narr_idx = None
    music_idx = None

    has_narration_stream = has_narration and narration_volume > 0.0
    if has_narration_stream:
        final_cmd.extend(["-i", narration_full_path])
        narr_idx = input_idx
        input_idx += 1

    if has_music:
        final_cmd.extend(["-stream_loop", "-1", "-i", music_path])
        music_idx = input_idx
        input_idx += 1

    vf_parts = ["setsar=1", "format=yuv420p"]
    if has_ass:
        escaped_ass = escape_ffmpeg_filter_path(ass_path)
        vf_parts = [f"ass='{escaped_ass}'", "setsar=1", "format=yuv420p"]
    vf_filter = ",".join(vf_parts)

    fade_out_start = max(0.5, total_duration - 1.2)
    if narr_idx is not None and music_idx is not None:
        # Mix crisp voiceover + ducked background music keeping narration dominant
        audio_fc = (
            f"[{narr_idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={narration_volume:.3f},asplit=2[narr_main][narr_sc];"
            f"[{music_idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:{total_duration:.3f},volume={music_volume:.3f},afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out_start:.3f}:d=1.2[mus_trim];"
            f"[mus_trim][narr_sc]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=350[mus_ducked];"
            f"[narr_main][mus_ducked]amix=inputs=2:duration=first:normalize=0[aout]"
        )
        final_cmd.extend(["-filter_complex", audio_fc, "-map", "0:v:0", "-map", "[aout]"])
    elif narr_idx is not None:
        audio_fc = (
            f"[{narr_idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:{total_duration:.3f},volume={narration_volume:.3f}[aout]"
        )
        final_cmd.extend(["-filter_complex", audio_fc, "-map", "0:v:0", "-map", "[aout]"])
    elif music_idx is not None:
        audio_fc = (
            f"[{music_idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:{total_duration:.3f},"
            f"volume={music_volume:.3f},afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out_start:.3f}:d=1.2[aout]"
        )
        final_cmd.extend(["-filter_complex", audio_fc, "-map", "0:v:0", "-map", "[aout]"])
    else:
        final_cmd.extend(["-map", "0:v:0", "-an"])

    final_cmd.extend([
        "-vf",
        vf_filter,
        "-t",
        f"{total_duration:.3f}",
        "-c:v",
        "libx264",
        "-profile:v",
        "main",
        "-level",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "21",
    ])
    if narr_idx is not None or music_idx is not None:
        final_cmd.extend(["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"])

    final_cmd.extend([
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        output_path,
    ])

    emit({"type": "progress", "progress": 82, "stage": "Encoding final MP4 with subtitles and audio mix"})

    proc = subprocess.Popen(
        final_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    last_pct = 82
    if proc.stdout is not None:
        for raw_line in proc.stdout:
            line = raw_line.strip()
            if line.startswith("out_time_ms="):
                try:
                    out_ms = int(line.split("=", 1)[1])
                    elapsed = out_ms / 1_000_000.0
                    ratio = min(1.0, max(0.0, elapsed / max(1.0, total_duration)))
                    pct = min(98, max(82, 82 + int(ratio * 16)))
                    if pct > last_pct:
                        last_pct = pct
                        emit({"type": "progress", "progress": pct, "stage": f"Exporting final MP4 ({pct}%)"})
                except ValueError:
                    pass

    stderr_output = proc.stderr.read() if proc.stderr is not None else ""
    return_code = proc.wait()
    if return_code != 0:
        tail = "\n".join(stderr_output.strip().splitlines()[-12:])
        raise RuntimeError(f"FFmpeg final export failed (code {return_code}): {tail}")

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        raise RuntimeError("FFmpeg finished without writing a non-empty MP4 output.")

    final_meta = run_ffprobe(output_path)
    if final_meta.get("codec") != "h264" or final_meta.get("durationSec", 0) <= 0:
        raise RuntimeError(f"Exported MP4 failed verification: {final_meta}")

    emit({
        "type": "done",
        "progress": 100,
        "stage": "Final MP4 rendered and verified",
        "outputPath": output_path,
        "srtPath": srt_path,
        "bytes": os.path.getsize(output_path),
        "metadata": final_meta,
    })


def resolve_camera_motion_mode(cfg: Dict[str, Any], scene_num: int) -> str:
    explicit = str(cfg.get("motionPreset") or "").strip().lower()
    if explicit in {"push_in", "pull_out", "pan_lr", "pan_rl", "tilt_up", "tilt_down", "orbit_drift"}:
        return explicit

    hint = " ".join([
        str(cfg.get("animationInstructions") or ""),
        str(cfg.get("cameraMovement") or ""),
        str(cfg.get("action") or ""),
        str(cfg.get("emotionalTone") or ""),
    ]).lower()

    if any(k in hint for k in ["pull out", "pull-out", "pull back", "pull-back", "zoom out", "zoom-out", "wide reveal", "establishing"]):
        return "pull_out"
    if any(k in hint for k in ["pan right to left", "right-to-left", "right to left"]):
        return "pan_rl"
    if any(k in hint for k in ["pan left", "left to right", "left-to-right", "tracking", "chase", "running", "driving", "hunting", "sweep"]):
        return "pan_lr"
    if any(k in hint for k in ["tilt up", "tilt-up", "rise", "launch", "ascend", "tower", "skyscraper", "rocket"]):
        return "tilt_up"
    if any(k in hint for k in ["tilt down", "tilt-down", "descend", "aerial descent"]):
        return "tilt_down"
    if any(k in hint for k in ["orbit", "parallax", "float", "drift", "space", "planet", "cosmos", "data", "neural"]):
        return "orbit_drift"
    if any(k in hint for k in ["push in", "push-in", "zoom in", "zoom-in", "close-up", "closeup", "focus", "portrait", "intimate"]):
        return "push_in"

    fallback_modes = ["push_in", "pull_out", "pan_lr", "orbit_drift", "pan_rl", "tilt_up"]
    return fallback_modes[(scene_num - 1) % len(fallback_modes)]


def escape_drawtext_value(text: str) -> str:
    clean = (text or "").replace("\r", " ").replace("\n", " ").strip()
    clean = "".join(ch if 32 <= ord(ch) < 127 else " " for ch in clean)
    clean = " ".join(clean.split())[:72]
    return (
        clean.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "")
        .replace('"', "")
        .replace("%", "")
    )


def generate_motion_scene(config_path: str) -> None:
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    output_path = str(cfg["outputPath"])
    aspect_ratio = str(cfg.get("aspectRatio") or "9:16")
    duration_sec = max(1.5, min(20.0, float(cfg.get("durationSec") or 5.0)))
    scene_num = int(cfg.get("sceneNumber") or 1)
    style = str(cfg.get("style") or "cinematic")
    audio_path = str(cfg.get("audioPath") or "").strip()
    image_path = str(cfg.get("imagePath") or "").strip()
    motion_mode = resolve_camera_motion_mode(cfg, scene_num)

    if aspect_ratio == "1:1":
        low_w, low_h, target_w, target_h = 96, 96, 1080, 1080
    elif aspect_ratio == "16:9":
        low_w, low_h, target_w, target_h = 128, 72, 1920, 1080
    else:
        low_w, low_h, target_w, target_h = 72, 128, 1080, 1920

    # Style-specific palettes: (r0, g0, b0, ra, ga, ba, orb1_hex, orb2_hex, accent_hex)
    palettes = {
        "modern-tech": (18, 28, 76, 28, 72, 110, "0x38BDF8", "0x818CF8", "0x22D3EE"),
        "cinematic": (28, 20, 56, 54, 34, 72, "0xA78BFA", "0xF472B6", "0xC4B5FD"),
        "documentary": (16, 36, 58, 32, 62, 78, "0x34D399", "0x38BDF8", "0x6EE7B7"),
        "minimalist": (24, 28, 42, 30, 38, 62, "0x94A3B8", "0xA78BFA", "0xE2E8F0"),
        "energetic-social": (72, 20, 86, 82, 42, 86, "0xFB7185", "0xFBBF24", "0xF472B6"),
        "storytelling": (54, 28, 42, 64, 46, 44, "0xF59E0B", "0xEC4899", "0xFCD34D"),
    }
    r0, g0, b0, ra, ga, ba, orb1_hex, orb2_hex, accent_hex = palettes.get(style, palettes["cinematic"])
    phase = round((scene_num - 1) * 1.15, 2)

    work_dir = os.path.dirname(output_path) or "/tmp"
    os.makedirs(work_dir, exist_ok=True)

    total_frames = max(45, int(round(duration_sec * 30)))
    has_audio = bool(audio_path and os.path.exists(audio_path) and os.path.getsize(audio_path) > 0)

    # Probe topic picture if provided
    img_w = 0
    img_h = 0
    if image_path and os.path.exists(image_path) and os.path.getsize(image_path) > 1024:
        try:
            img_meta = run_ffprobe(image_path)
            img_w = int(img_meta.get("width") or 0)
            img_h = int(img_meta.get("height") or 0)
        except Exception:
            img_w, img_h = 0, 0

    # Use `on` (output frame index, 0..total_frames-1) so single-image inputs animate smoothly every frame!
    ease_t = f"(0.5-0.5*cos(PI*min(1,on/{total_frames})))"
    rev_ease_t = f"(1-(0.5-0.5*cos(PI*min(1,on/{total_frames}))))"
    if motion_mode == "push_in":
        zp_z = f"1.02+0.16*{ease_t}"
        zp_x = f"iw/2-(iw/zoom/2)+16*sin(PI*on/{total_frames})"
        zp_y = f"ih/2-(ih/zoom/2)-10*sin(PI*on/{total_frames})"
    elif motion_mode == "pull_out":
        zp_z = f"1.18-0.16*{ease_t}"
        zp_x = f"iw/2-(iw/zoom/2)-16*sin(PI*on/{total_frames})"
        zp_y = f"ih/2-(ih/zoom/2)+10*sin(PI*on/{total_frames})"
    elif motion_mode == "pan_lr":
        zp_z = f"1.12+0.04*sin(PI*on/{total_frames})"
        zp_x = f"(iw-iw/zoom)*{ease_t}"
        zp_y = f"ih/2-(ih/zoom/2)+10*sin(PI*on/{total_frames})"
    elif motion_mode == "pan_rl":
        zp_z = f"1.11+0.05*{ease_t}"
        zp_x = f"(iw-iw/zoom)*{rev_ease_t}"
        zp_y = f"ih/2-(ih/zoom/2)-10*sin(PI*on/{total_frames})"
    elif motion_mode == "orbit_drift":
        zp_z = f"1.06+0.12*{ease_t}"
        zp_x = f"(iw-iw/zoom)*(0.5+0.35*sin(PI*on/{total_frames}))"
        zp_y = f"(ih-ih/zoom)*(0.5-0.30*cos(PI*on/{total_frames}))"
    elif motion_mode == "tilt_up":
        zp_z = f"1.14+0.04*{ease_t}"
        zp_x = f"iw/2-(iw/zoom/2)+8*sin(PI*on/{total_frames})"
        zp_y = f"(ih-ih/zoom)*{rev_ease_t}"
    else:
        # tilt_down
        zp_z = f"1.15-0.11*{ease_t}"
        zp_x = f"iw/2-(iw/zoom/2)"
        zp_y = f"(ih-ih/zoom)*{ease_t}"

    cmd: List[str] = ["ffmpeg", "-y"]
    filter_parts: List[str] = []

    if img_w <= 0 or img_h <= 0:
        raise RuntimeError(
            f"Scene {scene_num} is missing a verified image file ({image_path or 'empty'}). "
            "Refusing to render generic gradient placeholder."
        )

    # Clean, realistic full-bleed animated picture ONLY (no generic gradient placeholder, no orbs, no clutter overlays)
    target_ar = target_w / float(target_h)
    img_ar = img_w / float(img_h)
    ar_mismatch = max(target_ar / img_ar, img_ar / target_ar)

    # Oversample at 1.35x target dimensions before zoompan/crop for silky sub-pixel motion
    hi_w = ((int(target_w * 1.35)) // 2) * 2
    hi_h = ((int(target_h * 1.35)) // 2) * 2

    if ar_mismatch <= 1.75:
        cmd.extend(["-i", image_path])
        filter_parts.append(
            f"[0:v]scale={hi_w}:{hi_h}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={hi_w}:{hi_h},"
            f"zoompan=z='{zp_z}':x='{zp_x}':y='{zp_y}':d={total_frames}:fps=30:s={target_w}x{target_h},"
            f"setsar=1,eq=contrast=1.04:saturation=1.08,vignette=PI/6,format=yuv420p[vout]"
        )
    elif img_ar > target_ar:
        cmd.extend(["-loop", "1", "-framerate", "30", "-t", f"{duration_sec:.3f}", "-i", image_path])
        pan_h = (int(hi_h * 1.08) // 2) * 2
        ease_sec = f"(0.5-0.5*cos(PI*min(1,t/{duration_sec:.3f})))"
        x_expr = (
            f"(iw-ow)*{ease_sec}"
            if motion_mode in {"pan_lr", "push_in", "orbit_drift"}
            else f"(iw-ow)*(1-{ease_sec})"
        )
        filter_parts.append(
            f"[0:v]scale=-2:{pan_h}:flags=lanczos,"
            f"crop=w={hi_w}:h={hi_h}:x='{x_expr}':y='(ih-oh)/2',"
            f"scale={target_w}:{target_h}:flags=lanczos,"
            f"setsar=1,eq=contrast=1.04:saturation=1.08,vignette=PI/6,format=yuv420p[vout]"
        )
    else:
        cmd.extend(["-loop", "1", "-framerate", "30", "-t", f"{duration_sec:.3f}", "-i", image_path])
        pan_w = (int(hi_w * 1.08) // 2) * 2
        ease_sec = f"(0.5-0.5*cos(PI*min(1,t/{duration_sec:.3f})))"
        y_expr = (
            f"(ih-oh)*(1-{ease_sec})"
            if motion_mode in {"tilt_up", "pull_out"}
            else f"(ih-oh)*{ease_sec}"
        )
        filter_parts.append(
            f"[0:v]scale={pan_w}:-2:flags=lanczos,"
            f"crop=w={hi_w}:h={hi_h}:x='(iw-ow)/2':y='{y_expr}',"
            f"scale={target_w}:{target_h}:flags=lanczos,"
            f"setsar=1,eq=contrast=1.04:saturation=1.08,vignette=PI/6,format=yuv420p[vout]"
        )

    cmd.extend([
        "-filter_complex",
        ";".join(filter_parts),
        "-map",
        "[vout]",
        "-t",
        f"{duration_sec:.3f}",
        "-an",
        "-c:v",
        "libx264",
        "-profile:v",
        "main",
        "-level",
        "4.0",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        output_path,
    ])
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-14:])
        raise RuntimeError(f"FFmpeg motion scene failed: {tail}")

    meta = run_ffprobe(output_path)
    emit({
        "ok": True,
        "outputPath": output_path,
        "motionMode": motion_mode,
        "bytes": os.path.getsize(output_path),
        "metadata": meta,
    })


def _xml_escape(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _aspect_dims_for_illustration(aspect_ratio: str) -> tuple:
    if aspect_ratio == "16:9":
        return (1280, 720)
    if aspect_ratio == "1:1":
        return (1024, 1024)
    return (720, 1280)


def generate_scene_illustration(config_path: str) -> None:
    """
    Generate a crisp, scene-specific vector SVG illustration and rasterize it cleanly to JPEG
    via ImageMagick when external image generation or stock retrieval fails.
    """
    with open(config_path, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    output_path = str(cfg["outputPath"])
    svg_path = str(cfg.get("svgPath") or f"{os.path.splitext(output_path)[0]}.svg")
    aspect_ratio = str(cfg.get("aspectRatio") or "9:16")
    scene_num = max(1, int(cfg.get("sceneNumber") or 1))
    main_subject = str(cfg.get("mainSubject") or "")
    secondary = " ".join(str(x) for x in (cfg.get("secondarySubjects") or []))
    action = str(cfg.get("action") or "")
    location = str(cfg.get("location") or "")
    visual_desc = str(cfg.get("visualDescription") or "")
    narration = str(cfg.get("narration") or "")
    style = str(cfg.get("style") or "cinematic").lower()

    w, h = _aspect_dims_for_illustration(aspect_ratio)
    text_blob = f"{main_subject} {secondary} {action} {location} {visual_desc} {narration}".lower()

    os.makedirs(os.path.dirname(output_path) or "/tmp", exist_ok=True)
    mvg_lines: List[str] = []
    svg_shapes: List[str] = []

    def add_rect(x1: float, y1: float, x2: float, y2: float, fill: str, rx: float = 0) -> None:
        rw = max(1, x2 - x1)
        rh = max(1, y2 - y1)
        if rx > 0:
            mvg_lines.append(f"fill '{fill}' roundRectangle {x1:.1f},{y1:.1f} {x2:.1f},{y2:.1f} {rx:.1f},{rx:.1f}")
            svg_shapes.append(f'<rect x="{x1:.1f}" y="{y1:.1f}" width="{rw:.1f}" height="{rh:.1f}" rx="{rx:.1f}" fill="{fill}"/>')
        else:
            mvg_lines.append(f"fill '{fill}' rectangle {x1:.1f},{y1:.1f} {x2:.1f},{y2:.1f}")
            svg_shapes.append(f'<rect x="{x1:.1f}" y="{y1:.1f}" width="{rw:.1f}" height="{rh:.1f}" fill="{fill}"/>')

    def add_circle(cx: float, cy: float, r: float, fill: str, stroke: str = "none", sw: float = 0) -> None:
        if stroke != "none" and sw > 0:
            mvg_lines.append(f"fill '{fill}' stroke '{stroke}' stroke-width {sw:.1f} circle {cx:.1f},{cy:.1f} {cx + r:.1f},{cy:.1f}")
            svg_shapes.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw:.1f}"/>')
        else:
            mvg_lines.append(f"fill '{fill}' stroke 'none' circle {cx:.1f},{cy:.1f} {cx + r:.1f},{cy:.1f}")
            svg_shapes.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}"/>')

    def add_ellipse(cx: float, cy: float, rx: float, ry: float, fill: str, stroke: str = "none", sw: float = 0) -> None:
        if stroke != "none" and sw > 0:
            mvg_lines.append(f"fill '{fill}' stroke '{stroke}' stroke-width {sw:.1f} ellipse {cx:.1f},{cy:.1f} {rx:.1f},{ry:.1f} 0,360")
            svg_shapes.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{fill}" stroke="{stroke}" stroke-width="{sw:.1f}"/>')
        else:
            mvg_lines.append(f"fill '{fill}' stroke 'none' ellipse {cx:.1f},{cy:.1f} {rx:.1f},{ry:.1f} 0,360")
            svg_shapes.append(f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{rx:.1f}" ry="{ry:.1f}" fill="{fill}"/>')

    def add_polygon(pts: List[tuple], fill: str, stroke: str = "none", sw: float = 0) -> None:
        pt_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
        if stroke != "none" and sw > 0:
            mvg_lines.append(f"fill '{fill}' stroke '{stroke}' stroke-width {sw:.1f} polygon {pt_str}")
            svg_shapes.append(f'<polygon points="{pt_str}" fill="{fill}" stroke="{stroke}" stroke-width="{sw:.1f}"/>')
        else:
            mvg_lines.append(f"fill '{fill}' stroke 'none' polygon {pt_str}")
            svg_shapes.append(f'<polygon points="{pt_str}" fill="{fill}"/>')

    def add_path(d: str, fill: str = "none", stroke: str = "none", sw: float = 4) -> None:
        if stroke != "none":
            mvg_lines.append(f"fill '{fill}' stroke '{stroke}' stroke-width {sw:.1f} stroke-linecap round path '{d}'")
            svg_shapes.append(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{sw:.1f}" stroke-linecap="round"/>')
        else:
            mvg_lines.append(f"fill '{fill}' stroke 'none' path '{d}'")
            svg_shapes.append(f'<path d="{d}" fill="{fill}"/>')

    is_rabbit_mouse = ("rabbit" in text_blob) and (
        "mouse" in text_blob or "cheese" in text_blob or "log" in text_blob or "tree" in text_blob
    )
    is_cartoon = not is_rabbit_mouse and any(k in text_blob for k in [
        "tom", "jerry", "cartoon", "cat", "mouse", "cheese", "trap", "broom",
        "animated", "comic", "chase", "kitchen", "living room", "squeak"
    ])
    is_space = any(k in text_blob for k in [
        "space", "rocket", "astronaut", "planet", "moon", "lunar", "mars", "galaxy",
        "nebula", "star", "orbit", "launch", "cosmos", "spacecraft", "apollo", "nasa", "flag"
    ])
    is_wildlife = not is_rabbit_mouse and any(k in text_blob for k in [
        "lion", "elephant", "zebra", "giraffe", "tiger", "wildlife", "savanna",
        "jungle", "forest", "safari", "wolf", "eagle", "bear", "deer", "whale",
        "dolphin", "ocean", "cheetah", "leopard", "herd"
    ])
    is_tech_lab = any(k in text_blob for k in [
        "scientist", "holographic", "hologram", "laboratory", "lab", "interface",
        "artificial intelligence", "futuristic", "neural", "cyber"
    ])

    bg_top = "#0F172A"
    bg_bot = "#1E293B"
    variant = scene_num % 4

    if is_rabbit_mouse:
        # Expressive forest fable illustration: white rabbit grabbing cheese from wooden log while small brown mouse hides behind a tree
        bg_top = "#BAE6FD"
        bg_bot = "#FEF3C7"
        ground_y = h * 0.68
        # Distant forest hills & meadow
        add_ellipse(w * 0.25, ground_y, w * 0.45, h * 0.14, "#4ADE80")
        add_ellipse(w * 0.78, ground_y, w * 0.48, h * 0.16, "#22C55E")
        add_rect(0, ground_y, w, h, "#16A34A")

        # Large forest tree on the right where the small brown mouse hides behind the trunk
        tree_x = w * 0.76
        add_rect(tree_x - w * 0.075, h * 0.22, tree_x + w * 0.075, ground_y + h * 0.03, "#78350F", 10)
        add_circle(tree_x, h * 0.22, min(w, h) * 0.18, "#15803D")
        add_circle(tree_x - w * 0.08, h * 0.27, min(w, h) * 0.12, "#166534")
        add_circle(tree_x + w * 0.08, h * 0.27, min(w, h) * 0.12, "#22C55E")

        # Wooden log with yellow wedge of cheese on the left/center-left
        log_x = w * 0.46
        log_y = ground_y + h * 0.02
        add_rect(log_x - w * 0.18, log_y - h * 0.05, log_x + w * 0.15, log_y + h * 0.05, "#92400E", 16)
        add_ellipse(log_x + w * 0.14, log_y, w * 0.035, h * 0.048, "#D97706", "#78350F", 3)
        # Yellow cheese wedge resting on log
        cx, cy = log_x + w * 0.02, log_y - h * 0.055
        cs = min(w, h) * 0.085
        add_polygon([(cx - cs, cy + cs * 0.35), (cx + cs, cy + cs * 0.35), (cx + cs * 0.55, cy - cs * 0.55)], "#FACC15", "#B45309", 3)
        add_circle(cx + cs * 0.15, cy + cs * 0.05, cs * 0.14, "#CA8A04")
        add_circle(cx - cs * 0.25, cy + cs * 0.18, cs * 0.10, "#CA8A04")

        # White cartoon rabbit leaning forward on the left grabbing the cheese from the log
        rx, ry = w * 0.24, ground_y - h * 0.08
        rs = min(w, h) * 0.15
        add_ellipse(rx - rs * 0.42, ry + rs * 0.15, rs * 0.18, rs * 0.18, "#F8FAFC", "#475569", 3)  # fluffy tail
        add_ellipse(rx, ry + rs * 0.18, rs * 0.45, rs * 0.52, "#FFFFFF", "#475569", 3)  # body
        # Long white upright rabbit ears
        add_ellipse(rx - rs * 0.10, ry - rs * 0.92, rs * 0.13, rs * 0.44, "#FFFFFF", "#475569", 3)
        add_ellipse(rx + rs * 0.16, ry - rs * 0.90, rs * 0.13, rs * 0.42, "#FFFFFF", "#475569", 3)
        add_ellipse(rx - rs * 0.10, ry - rs * 0.90, rs * 0.06, rs * 0.30, "#FBCFE8")
        add_ellipse(rx + rs * 0.16, ry - rs * 0.88, rs * 0.06, rs * 0.28, "#FBCFE8")
        # Rabbit head & reaching paws grabbing cheese
        add_circle(rx + rs * 0.10, ry - rs * 0.36, rs * 0.33, "#FFFFFF", "#475569", 3)
        add_circle(rx + rs * 0.22, ry - rs * 0.40, rs * 0.065, "#0F172A")
        add_circle(rx + rs * 0.38, ry - rs * 0.32, rs * 0.05, "#F472B6")
        add_path(f"M {rx + rs*0.28:.1f},{ry - rs*0.02:.1f} L {cx - cs*0.55:.1f},{cy:.1f}", "none", "#FFFFFF", max(10, rs * 0.16))
        add_circle(cx - cs * 0.55, cy, rs * 0.11, "#FFFFFF", "#475569", 2.5)

        # Small brown mouse peeking out from behind the tree trunk watching the rabbit
        mx = tree_x - w * 0.09
        my = ground_y + h * 0.01
        ms = min(w, h) * 0.075
        add_circle(mx - ms * 0.18, my - ms * 0.52, ms * 0.26, "#9A5B32", "#3B2314", 2.5)
        add_circle(mx + ms * 0.22, my - ms * 0.50, ms * 0.26, "#9A5B32", "#3B2314", 2.5)
        add_circle(mx - ms * 0.18, my - ms * 0.52, ms * 0.14, "#FCD5B5")
        add_ellipse(mx + ms * 0.10, my, ms * 0.34, ms * 0.30, "#A66238", "#3B2314", 2.5)
        add_circle(mx, my - ms * 0.25, ms * 0.26, "#A66238", "#3B2314", 2.5)
        add_circle(mx - ms * 0.12, my - ms * 0.28, ms * 0.06, "#FFFFFF")
        add_circle(mx - ms * 0.13, my - ms * 0.28, ms * 0.03, "#0F172A")

    elif is_cartoon:
        # Expressive cartoon cat & mouse chase / comedy illustration
        bg_top = "#FFF3D6" if variant in (1, 3) else "#FCE7C8"
        bg_bot = "#F6D399"
        floor_y = h * 0.68
        # Wall & wainscot
        add_rect(0, floor_y - h * 0.08, w, floor_y, "#E6B88A")
        add_rect(0, floor_y - h * 0.088, w, floor_y - h * 0.075, "#B47B48")
        # Wooden floorboards
        add_rect(0, floor_y, w, h, "#C47E44")
        for i in range(1, 7):
            plank_y = floor_y + (h - floor_y) * (i / 7.0)
            add_path(f"M 0,{plank_y:.1f} L {w},{plank_y:.1f}", "none", "#8C5123", 3)
        # Window or kitchen cabinet in upper background
        if "kitchen" in text_blob or variant == 2:
            add_rect(w * 0.12, h * 0.14, w * 0.44, h * 0.42, "#93C5FD", 12)
            add_rect(w * 0.14, h * 0.16, w * 0.42, h * 0.40, "#DBEAFE", 8)
            add_path(f"M {w*0.28:.1f},{h*0.16:.1f} L {w*0.28:.1f},{h*0.40:.1f} M {w*0.14:.1f},{h*0.28:.1f} L {w*0.42:.1f},{h*0.28:.1f}", "none", "#94A3B8", 5)
        else:
            # Classic arched mouse hole in baseboard
            hole_x = w * (0.78 if variant != 0 else 0.22)
            add_rect(hole_x - w * 0.08, floor_y - h * 0.09, hole_x + w * 0.08, floor_y, "#2D1B12", 42)
            add_ellipse(hole_x, floor_y - h * 0.05, w * 0.075, h * 0.045, "#1A0F0A")

        # Shift character positions dynamically per scene number for genuine visual progression
        cat_x = w * (0.34 if variant == 1 else 0.62 if variant == 2 else 0.42 if variant == 3 else 0.30)
        cat_y = floor_y - h * 0.11
        mouse_x = w * (0.74 if variant == 1 else 0.28 if variant == 2 else 0.72 if variant == 3 else 0.68)
        mouse_y = floor_y + h * 0.03

        # Cat shadow & body (slate gray-blue cartoon cat)
        cat_s = min(w, h) * 0.21
        add_ellipse(cat_x, floor_y + h * 0.015, cat_s * 0.75, cat_s * 0.16, "#7C471D")
        # Tail
        add_path(
            f"M {cat_x - cat_s*0.45:.1f},{cat_y + cat_s*0.25:.1f} C {cat_x - cat_s*1.05:.1f},{cat_y - cat_s*0.10:.1f} {cat_x - cat_s*0.95:.1f},{cat_y - cat_s*0.75:.1f} {cat_x - cat_s*0.55:.1f},{cat_y - cat_s*0.62:.1f}",
            "none", "#5C728A", max(10, cat_s * 0.11)
        )
        # Torso & white tummy
        add_ellipse(cat_x, cat_y + cat_s * 0.22, cat_s * 0.50, cat_s * 0.62, "#637B94", "#2D3748", 4)
        add_ellipse(cat_x + cat_s * 0.05, cat_y + cat_s * 0.26, cat_s * 0.28, cat_s * 0.42, "#E2E8F0")
        # Paws reaching toward chase direction
        paw_dir = 1 if mouse_x > cat_x else -1
        add_ellipse(cat_x + paw_dir * cat_s * 0.56, cat_y + cat_s * 0.05, cat_s * 0.20, cat_s * 0.12, "#F8FAFC", "#2D3748", 3)
        add_ellipse(cat_x - cat_s * 0.26, floor_y - cat_s * 0.04, cat_s * 0.18, cat_s * 0.10, "#F8FAFC", "#2D3748", 3)
        add_ellipse(cat_x + cat_s * 0.26, floor_y - cat_s * 0.04, cat_s * 0.18, cat_s * 0.10, "#F8FAFC", "#2D3748", 3)
        # Pointed cat ears
        hy = cat_y - cat_s * 0.42
        add_polygon([(cat_x - cat_s * 0.44, hy - cat_s * 0.10), (cat_x - cat_s * 0.56, hy - cat_s * 0.72), (cat_x - cat_s * 0.12, hy - cat_s * 0.34)], "#5C728A", "#2D3748", 4)
        add_polygon([(cat_x + cat_s * 0.44, hy - cat_s * 0.10), (cat_x + cat_s * 0.56, hy - cat_s * 0.72), (cat_x + cat_s * 0.12, hy - cat_s * 0.34)], "#5C728A", "#2D3748", 4)
        add_polygon([(cat_x - cat_s * 0.40, hy - cat_s * 0.18), (cat_x - cat_s * 0.48, hy - cat_s * 0.58), (cat_x - cat_s * 0.20, hy - cat_s * 0.34)], "#F9A8D4")
        add_polygon([(cat_x + cat_s * 0.40, hy - cat_s * 0.18), (cat_x + cat_s * 0.48, hy - cat_s * 0.58), (cat_x + cat_s * 0.20, hy - cat_s * 0.34)], "#F9A8D4")
        # Cat head, eyes, muzzle, nose, whiskers
        add_ellipse(cat_x, hy, cat_s * 0.46, cat_s * 0.40, "#6E88A3", "#2D3748", 4)
        add_ellipse(cat_x, hy + cat_s * 0.14, cat_s * 0.34, cat_s * 0.20, "#F8FAFC")
        add_ellipse(cat_x - cat_s * 0.16, hy - cat_s * 0.08, cat_s * 0.11, cat_s * 0.15, "#FEF08A", "#1E293B", 3)
        add_ellipse(cat_x + cat_s * 0.16, hy - cat_s * 0.08, cat_s * 0.11, cat_s * 0.15, "#FEF08A", "#1E293B", 3)
        add_circle(cat_x - cat_s * 0.14 + paw_dir * 4, hy - cat_s * 0.06, cat_s * 0.05, "#0F172A")
        add_circle(cat_x + cat_s * 0.14 + paw_dir * 4, hy - cat_s * 0.06, cat_s * 0.05, "#0F172A")
        add_ellipse(cat_x, hy + cat_s * 0.06, cat_s * 0.08, cat_s * 0.055, "#F472B6", "#1E293B", 2)
        add_path(
            f"M {cat_x - cat_s*0.24:.1f},{hy + cat_s*0.10:.1f} L {cat_x - cat_s*0.62:.1f},{hy + cat_s*0.04:.1f} "
            f"M {cat_x - cat_s*0.24:.1f},{hy + cat_s*0.16:.1f} L {cat_x - cat_s*0.62:.1f},{hy + cat_s*0.20:.1f} "
            f"M {cat_x + cat_s*0.24:.1f},{hy + cat_s*0.10:.1f} L {cat_x + cat_s*0.62:.1f},{hy + cat_s*0.04:.1f} "
            f"M {cat_x + cat_s*0.24:.1f},{hy + cat_s*0.16:.1f} L {cat_x + cat_s*0.62:.1f},{hy + cat_s*0.20:.1f}",
            "none", "#1E293B", 2.5
        )

        # Mouse (warm brown cartoon mouse with big round ears + cheese wedge)
        ms = min(w, h) * 0.095
        add_ellipse(mouse_x, mouse_y + ms * 0.42, ms * 0.58, ms * 0.14, "#7C471D")
        add_path(
            f"M {mouse_x - ms*0.35:.1f},{mouse_y + ms*0.28:.1f} C {mouse_x - ms*1.15:.1f},{mouse_y + ms*0.45:.1f} {mouse_x - ms*1.25:.1f},{mouse_y - ms*0.25:.1f} {mouse_x - ms*0.90:.1f},{mouse_y - ms*0.35:.1f}",
            "none", "#F4A28C", max(4, ms * 0.09)
        )
        add_circle(mouse_x - ms * 0.36, mouse_y - ms * 0.52, ms * 0.30, "#9A5B32", "#3B2314", 3)
        add_circle(mouse_x + ms * 0.34, mouse_y - ms * 0.52, ms * 0.30, "#9A5B32", "#3B2314", 3)
        add_circle(mouse_x - ms * 0.36, mouse_y - ms * 0.52, ms * 0.18, "#FCD5B5")
        add_circle(mouse_x + ms * 0.34, mouse_y - ms * 0.52, ms * 0.18, "#FCD5B5")
        add_ellipse(mouse_x, mouse_y + ms * 0.10, ms * 0.42, ms * 0.36, "#A66238", "#3B2314", 3)
        add_ellipse(mouse_x + ms * 0.05, mouse_y + ms * 0.16, ms * 0.24, ms * 0.22, "#F5CBA7")
        add_circle(mouse_x, mouse_y - ms * 0.25, ms * 0.32, "#A66238", "#3B2314", 3)
        add_circle(mouse_x - ms * 0.11, mouse_y - ms * 0.31, ms * 0.08, "#FFFFFF")
        add_circle(mouse_x + ms * 0.11, mouse_y - ms * 0.31, ms * 0.08, "#FFFFFF")
        add_circle(mouse_x - ms * 0.10, mouse_y - ms * 0.31, ms * 0.04, "#0F172A")
        add_circle(mouse_x + ms * 0.12, mouse_y - ms * 0.31, ms * 0.04, "#0F172A")
        add_circle(mouse_x + paw_dir * ms * 0.24, mouse_y - ms * 0.20, ms * 0.06, "#1E293B")

        # Cheese wedge prop
        if "cheese" in text_blob or variant in (1, 3):
            cx = mouse_x + (ms * 0.85 if mouse_x < w * 0.72 else -ms * 1.15)
            cy = mouse_y + ms * 0.22
            add_polygon([(cx - ms * 0.48, cy + ms * 0.22), (cx + ms * 0.48, cy + ms * 0.22), (cx + ms * 0.24, cy - ms * 0.30)], "#FACC15", "#B45309", 3)
            add_circle(cx + ms * 0.04, cy + ms * 0.06, ms * 0.08, "#CA8A04")
            add_circle(cx - ms * 0.16, cy + ms * 0.12, ms * 0.06, "#CA8A04")

        # Comic action speed lines
        mid_x = (cat_x + mouse_x) / 2.0
        add_path(
            f"M {mid_x - w*0.09:.1f},{floor_y - h*0.18:.1f} L {mid_x + w*0.05:.1f},{floor_y - h*0.18:.1f} "
            f"M {mid_x - w*0.11:.1f},{floor_y - h*0.14:.1f} L {mid_x + w*0.02:.1f},{floor_y - h*0.14:.1f}",
            "none", "#F97316", 4
        )

    elif is_space:
        # Deep cosmic space exploration scene
        bg_top = "#04081A"
        bg_bot = "#1B1145" if variant in (1, 3) else "#0F2942"
        # Twinkling stars
        for idx in range(72):
            sx = ((idx * 173 + scene_num * 97) % 96 + 2) / 100.0 * w
            sy = ((idx * 251 + scene_num * 53) % 72 + 2) / 100.0 * h
            sr = 1.6 if idx % 3 else 3.2
            add_circle(sx, sy, sr, "#F8FAFC" if idx % 4 else "#93C5FD")

        is_moon_flag = ("moon" in text_blob or "lunar" in text_blob) and ("flag" in text_blob or "astronaut" in text_blob)
        if is_moon_flag:
            # Blue Earth in the distant cosmic sky + grey cratered Moon surface + astronaut planting American flag
            ex, ey = w * 0.78, h * 0.22
            er = min(w, h) * 0.11
            add_circle(ex, ey, er, "#2563EB")
            add_ellipse(ex - er * 0.22, ey - er * 0.12, er * 0.35, er * 0.22, "#22C55E")
            add_ellipse(ex + er * 0.25, ey + er * 0.15, er * 0.28, er * 0.18, "#4ADE80")
            # Grey lunar horizon with craters
            horizon = h * 0.68
            add_ellipse(w * 0.50, h * 0.92, w * 0.85, h * 0.30, "#94A3B8")
            add_rect(0, horizon, w, h, "#64748B")
            add_ellipse(w * 0.22, horizon + h * 0.14, w * 0.09, h * 0.025, "#475569")
            add_ellipse(w * 0.82, horizon + h * 0.18, w * 0.11, h * 0.030, "#475569")
            # Astronaut standing on lunar surface holding/planting American flag
            ax, ay = w * 0.40, horizon - h * 0.09
            s = min(w, h) * 0.14
            add_rect(ax - s * 0.44, ay - s * 0.20, ax + s * 0.44, ay + s * 0.48, "#CBD5E1", 16)
            add_rect(ax - s * 0.32, ay - s * 0.08, ax + s * 0.32, ay + s * 0.58, "#F8FAFC", 20)
            add_rect(ax - s * 0.26, ay + s * 0.55, ax - s * 0.06, horizon + 10, "#E2E8F0", 6)
            add_rect(ax + s * 0.06, ay + s * 0.55, ax + s * 0.26, horizon + 10, "#E2E8F0", 6)
            add_circle(ax, ay - s * 0.42, s * 0.35, "#F8FAFC", "#94A3B8", 4)
            add_ellipse(ax + s * 0.05, ay - s * 0.42, s * 0.23, s * 0.19, "#F59E0B", "#92400E", 3)
            # American flag planted cleanly into lunar dust
            fx = ax + s * 0.92
            fy_top = ay - s * 0.72
            add_path(f"M {ax + s*0.30:.1f},{ay + s*0.05:.1f} L {fx:.1f},{ay - s*0.05:.1f}", "none", "#F8FAFC", max(10, s * 0.16))
            add_path(f"M {fx:.1f},{horizon + 10:.1f} L {fx:.1f},{fy_top:.1f}", "none", "#E2E8F0", 6)
            fw, fh = s * 1.15, s * 0.68
            add_rect(fx, fy_top, fx + fw, fy_top + fh, "#FFFFFF")
            for stripe_i in range(0, 7, 2):
                sy1 = fy_top + (fh / 7.0) * stripe_i
                sy2 = sy1 + (fh / 7.0)
                add_rect(fx, sy1, fx + fw, sy2, "#DC2626")
            add_rect(fx, fy_top, fx + fw * 0.45, fy_top + fh * 0.55, "#1D4ED8")
        else:
            # Planet with ring
            px = w * (0.72 if variant in (1, 3) else 0.28)
            py = h * 0.28
            pr = min(w, h) * 0.17
            add_circle(px, py, pr * 1.18, "#312E81")
            add_circle(px, py, pr, "#F59E0B" if "mars" in text_blob else "#38BDF8")
            add_circle(px - pr * 0.22, py - pr * 0.18, pr * 0.22, "#7DD3FC" if "mars" not in text_blob else "#FDBA74")
            add_ellipse(px, py, pr * 1.85, pr * 0.34, "none", "#E2E8F0", 6)

            if "astronaut" in text_blob or variant == 2:
                ax, ay = w * 0.50, h * 0.56
                s = min(w, h) * 0.16
                add_path(f"M {ax - s*0.6:.1f},{ay + s*0.5:.1f} C {ax - s*1.4:.1f},{ay + s*1.1:.1f} {ax - s*0.8:.1f},{h*0.95:.1f} {w*0.15:.1f},{h:.1f}", "none", "#CBD5E1", 4)
                add_rect(ax - s * 0.48, ay - s * 0.25, ax + s * 0.48, ay + s * 0.52, "#CBD5E1", 18)
                add_rect(ax - s * 0.36, ay - s * 0.10, ax + s * 0.36, ay + s * 0.65, "#F8FAFC", 24)
                add_circle(ax, ay - s * 0.48, s * 0.38, "#F8FAFC", "#94A3B8", 4)
                add_ellipse(ax + s * 0.04, ay - s * 0.48, s * 0.26, s * 0.22, "#F59E0B", "#92400E", 3)
                add_path(f"M {ax - s*0.36:.1f},{ay + s*0.05:.1f} L {ax - s*0.72:.1f},{ay - s*0.15:.1f} M {ax + s*0.36:.1f},{ay + s*0.05:.1f} L {ax + s*0.72:.1f},{ay + s*0.25:.1f}", "none", "#E2E8F0", max(12, s * 0.20))
            else:
                rx, ry = w * 0.50, h * 0.54
                rs = min(w, h) * 0.15
                add_polygon([(rx - rs * 0.28, ry + rs * 0.85), (rx + rs * 0.28, ry + rs * 0.85), (rx, ry + rs * 2.05)], "#F97316")
                add_polygon([(rx - rs * 0.15, ry + rs * 0.85), (rx + rs * 0.15, ry + rs * 0.85), (rx, ry + rs * 1.65)], "#FEF08A")
                add_polygon([(rx - rs * 0.35, ry + rs * 0.45), (rx - rs * 0.72, ry + rs * 0.92), (rx - rs * 0.25, ry + rs * 0.85)], "#EF4444")
                add_polygon([(rx + rs * 0.35, ry + rs * 0.45), (rx + rs * 0.72, ry + rs * 0.92), (rx + rs * 0.25, ry + rs * 0.85)], "#EF4444")
                add_ellipse(rx, ry, rs * 0.38, rs * 0.95, "#F8FAFC", "#CBD5E1", 4)
                add_polygon([(rx - rs * 0.34, ry - rs * 0.42), (rx + rs * 0.34, ry - rs * 0.42), (rx, ry - rs * 1.28)], "#EF4444")
                add_circle(rx, ry - rs * 0.10, rs * 0.17, "#0EA5E9", "#1E293B", 4)

    elif is_wildlife:
        # Warm golden-hour savanna / wildlife illustration
        is_ocean = any(k in text_blob for k in ["ocean", "whale", "dolphin", "sea", "coral"])
        if is_ocean:
            bg_top = "#0284C7"
            bg_bot = "#0F172A"
            horizon = h * 0.48
            add_circle(w * 0.50, horizon - h * 0.14, min(w, h) * 0.11, "#FEF08A")
            add_rect(0, horizon, w, h, "#0369A1")
            add_ellipse(w * 0.50, h * 0.68, min(w, h) * 0.24, min(w, h) * 0.11, "#1E293B")
            add_polygon([(w * 0.68, h * 0.66), (w * 0.84, h * 0.56), (w * 0.80, h * 0.72)], "#1E293B")
        else:
            bg_top = "#F59E0B" if variant in (1, 3) else "#0D9488"
            bg_bot = "#7C2D12" if variant in (1, 3) else "#064E3B"
            horizon = h * 0.62
            add_circle(w * 0.52, horizon - h * 0.18, min(w, h) * 0.15, "#FEF08A")
            add_polygon([(0, horizon), (w * 0.28, horizon - h * 0.12), (w * 0.62, horizon - h * 0.04), (w * 0.88, horizon - h * 0.15), (w, horizon)], "#9A3412" if variant in (1, 3) else "#115E59")
            tx = w * 0.18
            add_path(f"M {tx:.1f},{horizon:.1f} L {tx - w*0.01:.1f},{horizon - h*0.18:.1f}", "none", "#1C1917", 10)
            add_ellipse(tx, horizon - h * 0.20, w * 0.16, h * 0.032, "#1C1917")
            add_rect(0, horizon, w, h, "#D97706" if "zebra" in text_blob else "#292524")

            s = min(w, h) * 0.13
            if "zebra" in text_blob or "chase" in text_blob or "chasing" in text_blob:
                # Active dynamic chase: leaping lion on the left chasing running striped zebra on the right
                lx, ly = w * 0.30, horizon - h * 0.05
                add_ellipse(lx, ly, s * 0.80, s * 0.34, "#B45309")
                add_circle(lx + s * 0.72, ly - s * 0.20, s * 0.38, "#78350F")
                add_circle(lx + s * 0.82, ly - s * 0.22, s * 0.22, "#D97706")
                add_path(f"M {lx - s*0.65:.1f},{ly:.1f} L {lx - s*1.15:.1f},{ly + s*0.35:.1f} M {lx + s*0.55:.1f},{ly:.1f} L {lx + s*1.05:.1f},{ly - s*0.18:.1f}", "none", "#B45309", max(6, s * 0.14))
                # Running striped zebra ahead on the right
                zx, zy = w * 0.72, horizon - h * 0.06
                add_ellipse(zx, zy, s * 0.82, s * 0.38, "#F8FAFC", "#0F172A", 3)
                for si in range(-2, 3):
                    sx_stripe = zx + si * s * 0.24
                    add_path(f"M {sx_stripe:.1f},{zy - s*0.32:.1f} L {sx_stripe - s*0.08:.1f},{zy + s*0.32:.1f}", "none", "#0F172A", max(4, s * 0.08))
                add_polygon([(zx + s * 0.55, zy - s * 0.15), (zx + s * 0.98, zy - s * 0.72), (zx + s * 0.78, zy + s * 0.02)], "#F8FAFC", "#0F172A", 2.5)
                add_ellipse(zx + s * 1.05, zy - s * 0.65, s * 0.26, s * 0.16, "#F8FAFC", "#0F172A", 2.5)
                add_path(f"M {zx - s*0.45:.1f},{zy + s*0.25:.1f} L {zx - s*0.82:.1f},{horizon + 12:.1f} M {zx + s*0.45:.1f},{zy + s*0.25:.1f} L {zx + s*0.92:.1f},{horizon + 12:.1f}", "none", "#F8FAFC", max(6, s * 0.12))
                # Motion speed dust lines
                add_path(f"M {lx - s*1.2:.1f},{horizon + 8:.1f} L {zx - s*0.9:.1f},{horizon + 8:.1f}", "none", "#FEF3C7", 4)
            elif "elephant" in text_blob:
                ax, ay = w * 0.55, horizon - h * 0.05
                add_ellipse(ax, ay, s * 0.90, s * 0.60, "#1C1917")
                add_circle(ax + s * 0.85, ay - s * 0.18, s * 0.42, "#1C1917")
                add_path(f"M {ax + s*1.15:.1f},{ay - s*0.05:.1f} C {ax + s*1.35:.1f},{ay + s*0.35:.1f} {ax + s*1.15:.1f},{ay + s*0.60:.1f} {ax + s*0.95:.1f},{ay + s*0.48:.1f}", "none", "#1C1917", max(10, s * 0.16))
                add_rect(ax - s * 0.55, ay, ax - s * 0.30, horizon + 12, "#1C1917")
                add_rect(ax + s * 0.25, ay, ax + s * 0.50, horizon + 12, "#1C1917")
            else:
                ax, ay = w * (0.60 if variant in (1, 2) else 0.38), horizon - h * 0.05
                add_ellipse(ax, ay, s * 0.80, s * 0.38, "#1C1917")
                add_circle(ax + s * 0.72, ay - s * 0.22, s * 0.40, "#1C1917")
                add_circle(ax + s * 0.84, ay - s * 0.24, s * 0.24, "#44403C")
                add_path(f"M {ax - s*0.75:.1f},{ay:.1f} C {ax - s*1.25:.1f},{ay - s*0.35:.1f} {ax - s*1.10:.1f},{ay - s*0.65:.1f} {ax - s*0.90:.1f},{ay - s*0.58:.1f}", "none", "#1C1917", 6)
                add_rect(ax - s * 0.55, ay, ax - s * 0.36, horizon + 12, "#1C1917")
                add_rect(ax + s * 0.28, ay, ax + s * 0.46, horizon + 12, "#1C1917")

    elif is_tech_lab:
        # Futuristic AI laboratory: scientist interacting with glowing holographic interface
        bg_top, bg_bot = "#060D24", "#0F294A"
        floor_y = h * 0.72
        add_rect(0, floor_y, w, h, "#0F172A")
        add_rect(w * 0.08, h * 0.14, w * 0.92, floor_y - h * 0.04, "#0B1633", 14)
        # Scientist on the left in white lab coat reaching arm toward hologram
        sx, sy = w * 0.32, floor_y - h * 0.16
        s = min(w, h) * 0.15
        add_rect(sx - s * 0.42, sy - s * 0.15, sx + s * 0.42, floor_y, "#F8FAFC", 16)
        add_circle(sx, sy - s * 0.48, s * 0.30, "#FDBA74")
        add_ellipse(sx - s * 0.02, sy - s * 0.64, s * 0.30, s * 0.16, "#1E293B")
        # Glowing holographic AI neural interface on the right
        hx, hy = w * 0.66, h * 0.44
        add_path(f"M {sx + s*0.35:.1f},{sy + s*0.02:.1f} L {hx - s*0.75:.1f},{hy + s*0.18:.1f}", "none", "#F8FAFC", max(10, s * 0.18))
        add_rect(hx - s * 1.10, hy - s * 0.85, hx + s * 1.10, hy + s * 0.85, "#0EA5E9", 18)
        add_rect(hx - s * 1.00, hy - s * 0.75, hx + s * 1.00, hy + s * 0.75, "#082F49", 14)
        add_circle(hx, hy, s * 0.48, "none", "#38BDF8", 4)
        add_circle(hx, hy, s * 0.24, "#22D3EE")
        add_circle(hx - s * 0.55, hy - s * 0.35, s * 0.12, "#7DD3FC")
        add_circle(hx + s * 0.58, hy + s * 0.32, s * 0.12, "#7DD3FC")
        add_path(f"M {hx - s*0.55:.1f},{hy - s*0.35:.1f} L {hx:.1f},{hy:.1f} L {hx + s*0.58:.1f},{hy + s*0.32:.1f}", "none", "#38BDF8", 3)

    else:
        # Expressive thematic scene illustration for tech / city / history / general storytelling
        if "tech" in style:
            bg_top, bg_bot = "#091534", "#1D4ED8"
            glow = "#38BDF8"
        elif "documentary" in style:
            bg_top, bg_bot = "#0F2E2E", "#1E3A5F"
            glow = "#34D399"
        else:
            bg_top, bg_bot = "#1E1B4B", "#7C2D12"
            glow = "#F59E0B"

        horizon = h * 0.65
        add_circle(w * 0.50, horizon - h * 0.16, min(w, h) * 0.17, glow)
        add_circle(w * 0.50, horizon - h * 0.16, min(w, h) * 0.12, "#FEF3C7")
        pts = [(0, horizon)]
        for i in range(1, 8):
            px = (w / 7.0) * i
            peak = h * (0.08 + ((i * 37 + scene_num * 23) % 16) / 100.0)
            pts.append((px, horizon - peak))
        pts.append((w, horizon))
        add_polygon(pts, "#1E293B")
        add_rect(0, horizon, w, h, "#0F172A")
        add_ellipse(w * 0.50, horizon + h * 0.10, w * 0.38, h * 0.03, glow)

    # Write clean SVG source artifact for auditability & UI/asset completeness
    svg_doc = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">\n'
        f'  <defs>\n'
        f'    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">\n'
        f'      <stop offset="0%" stop-color="{bg_top}"/>\n'
        f'      <stop offset="100%" stop-color="{bg_bot}"/>\n'
        f'    </linearGradient>\n'
        f'  </defs>\n'
        f'  <rect x="0" y="0" width="{w}" height="{h}" fill="url(#sky)"/>\n'
        f'  <!-- Scene {scene_num}: {_xml_escape(main_subject)} | {_xml_escape(action)} -->\n'
        + "\n".join(f"  {line}" for line in svg_shapes)
        + "\n</svg>\n"
    )
    with open(svg_path, "w", encoding="utf-8") as f:
        f.write(svg_doc)

    # Render identical geometry to high-resolution JPEG via ImageMagick MVG draw
    mvg_path = f"{output_path}.mvg"
    with open(mvg_path, "w", encoding="utf-8") as f:
        f.write("\n".join(mvg_lines))

    try:
        cmd = [
            "convert",
            "-size",
            f"{w}x{h}",
            f"gradient:{bg_top}-{bg_bot}",
            "-draw",
            f"@{mvg_path}",
            "-quality",
            "92",
            output_path,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "ImageMagick illustration render failed.")
    finally:
        if os.path.exists(mvg_path):
            try:
                os.remove(mvg_path)
            except OSError:
                pass

    meta = run_ffprobe(output_path)
    emit({
        "ok": True,
        "outputPath": output_path,
        "svgPath": svg_path,
        "bytes": os.path.getsize(output_path),
        "metadata": meta,
    })


def main() -> None:
    if len(sys.argv) < 3:
        raise SystemExit("Usage: videoWorker.py <probe|probe-audio|extract-audio|render|generate-music-bed|generate-motion-scene|generate-scene-illustration|compose> <args...>")

    action = sys.argv[1]
    try:
        if action == "probe":
            info = run_ffprobe(sys.argv[2])
            emit({"ok": True, "metadata": info})
        elif action == "probe-audio":
            info = probe_audio(sys.argv[2])
            emit({"ok": True, "metadata": info})
        elif action == "extract-audio":
            if len(sys.argv) < 4:
                raise RuntimeError("Missing output path for extract-audio.")
            extract_audio(sys.argv[2], sys.argv[3])
        elif action == "render":
            render_clip(sys.argv[2])
        elif action == "generate-music-bed":
            generate_music_bed(sys.argv[2])
        elif action == "generate-motion-scene":
            generate_motion_scene(sys.argv[2])
        elif action == "generate-scene-illustration":
            generate_scene_illustration(sys.argv[2])
        elif action == "compose":
            compose_ai_video(sys.argv[2])
        else:
            raise RuntimeError(f"Unknown worker action: {action}")
    except Exception as exc:
        emit({"type": "error", "ok": False, "error": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
