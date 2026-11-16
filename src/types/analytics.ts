export interface AnalyticsInsightRecommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  action: string;
  expectedImpact: string;
}

export interface AnalyticsInsightsResponse {
  headlineSummary: string;
  topStrength: string;
  biggestOpportunity: string;
  recommendations: AnalyticsInsightRecommendation[];
  generatedAt: string;
  model: string;
}

export interface AnalyticsSummaryInput {
  dateRangeLabel: string;
  platformFilter: string;
  totalGenerations: number;
  totalProjects: number;
  totalThumbnails: number;
  totalVideoJobs: number;
  avgQualityScore: number | null;
  scoredCount: number;
  publishedPostsCount: number;
  scheduledPostsCount: number;
  totalReachAndViews: number;
  totalInteractions: number;
  platformBreakdown: Array<{
    platform: string;
    generations: number;
    publishedPosts: number;
    views: number;
    interactions: number;
  }>;
  topTones: Array<{ tone: string; count: number }>;
  topLanguages: Array<{ language: string; count: number }>;
}
