export const ENDPOINTS = {
  "official.article-summary": {
    product: "official",
    path: "/datacube/getarticlesummary",
    description: "Daily article summary data."
  },
  "official.article-total": {
    product: "official",
    path: "/datacube/getarticletotal",
    description: "Daily total article metrics."
  },
  "official.user-read": {
    product: "official",
    path: "/datacube/getuserread",
    description: "Article reading metrics by user dimension."
  },
  "official.user-read-hour": {
    product: "official",
    path: "/datacube/getuserreadhour",
    description: "Hourly article reading metrics."
  },
  "official.user-share": {
    product: "official",
    path: "/datacube/getusershare",
    description: "Article sharing metrics."
  },
  "official.user-share-hour": {
    product: "official",
    path: "/datacube/getusersharehour",
    description: "Hourly article sharing metrics."
  },
  "official.user-summary": {
    product: "official",
    path: "/datacube/getusersummary",
    description: "Follower change metrics."
  },
  "official.user-cumulate": {
    product: "official",
    path: "/datacube/getusercumulate",
    description: "Follower cumulative metrics."
  },
  "mini.daily-summary": {
    product: "mini",
    path: "/datacube/getweanalysisappiddailysummarytrend",
    description: "Mini Program daily summary trend."
  },
  "mini.daily-visit-trend": {
    product: "mini",
    path: "/datacube/getweanalysisappiddailyvisittrend",
    description: "Mini Program daily visit trend."
  },
  "mini.weekly-visit-trend": {
    product: "mini",
    path: "/datacube/getweanalysisappidweeklyvisittrend",
    description: "Mini Program weekly visit trend."
  },
  "mini.monthly-visit-trend": {
    product: "mini",
    path: "/datacube/getweanalysisappidmonthlyvisittrend",
    description: "Mini Program monthly visit trend."
  },
  "mini.visit-page": {
    product: "mini",
    path: "/datacube/getweanalysisappidvisitpage",
    description: "Mini Program page visit metrics."
  },
  "mini.visit-distribution": {
    product: "mini",
    path: "/datacube/getweanalysisappidvisitdistribution",
    description: "Mini Program visit distribution metrics."
  },
  "mini.user-portrait": {
    product: "mini",
    path: "/datacube/getweanalysisappiduserportrait",
    description: "Mini Program user portrait metrics."
  },
  "mini.daily-retain": {
    product: "mini",
    path: "/datacube/getweanalysisappiddailyretaininfo",
    description: "Mini Program daily retention metrics."
  },
  "mini.weekly-retain": {
    product: "mini",
    path: "/datacube/getweanalysisappidweeklyretaininfo",
    description: "Mini Program weekly retention metrics."
  },
  "mini.monthly-retain": {
    product: "mini",
    path: "/datacube/getweanalysisappidmonthlyretaininfo",
    description: "Mini Program monthly retention metrics."
  }
};

export function getEndpoint(name) {
  return ENDPOINTS[name] || null;
}

export function listEndpoints() {
  return Object.entries(ENDPOINTS).map(([name, info]) => ({ name, ...info }));
}
