// Websearch implementation using Miyami API https://github.com/ankushthakur2007/miyami_websearch_tool

import type { WebSearchConfig } from "../../../shared/types";
import type { Logger } from "../utils/logger";

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  engine: string;
}
export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  answers: string[];
  suggestions: string[];
  infoboxes: Array<{ title: string; content: string }>;
}
export interface FetchWebpageResponse {
  url: string;
  title: string;
  content: string;
  wordCount: number;
}
export interface SearchAndFetchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    content: string;
    wordCount: number;
    fetchStatus: string;
  }>;
}
export interface DeepResearchResponse {
  queries: string[];
  compiledReport: string;
  totalResults: number;
  successfulFetches: number;
}
export interface CrawlSiteResponse {
  startUrl: string;
  pagesCrawled: number;
  pages: Array<{ url: string; title: string; content: string; wordCount: number; depth: number }>;
  totalWords: number;
}

function buildBaseUrl(config: WebSearchConfig): string {
  return config.baseUrl.replace(/\/+$/, "");
}

function commonParams(config: WebSearchConfig): Record<string, string> {
  const params: Record<string, string> = { language: config.language };
  if (config.autoBypass) params.auto_bypass = "true";
  return params;
}

async function miyamiFetch(log: Logger, url: string, timeoutMs = 15000): Promise<Record<string, unknown>> {
  log.debug(`Miyami API request: ${url}`);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Miyami API returned HTTP ${res.status}: ${res.statusText}`);
  return (await res.json()) as Record<string, unknown>;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

export async function searchWeb(query: string, config: WebSearchConfig, log: Logger): Promise<WebSearchResponse> {
  const params = new URLSearchParams({ ...commonParams(config), query });
  const url = `${buildBaseUrl(config)}/search-api?${params.toString()}`;
  const data = await miyamiFetch(log, url);

  const rawResults = ((data.results as any[]) || []).filter((r) => r.url && r.title);
  const results: WebSearchResult[] = rawResults
    .slice(0, config.maxResults)
    .map((r) => ({ title: r.title || "", url: r.url || "", description: r.content || "", engine: r.engine || "" }));

  const answers = (data.answers as string[]) || [];
  const suggestions = (data.suggestions as string[]) || [];
  const infoboxes = ((data.infoboxes as any[]) || [])
    .filter((ib) => ib.title || ib.content)
    .map((ib) => ({
      title: ib.title || "",
      content: ib.content || "",
    }));

  log.info(`Search for "${query}": ${results.length} results, ${answers.length} answers`);
  return { query, results, answers, suggestions, infoboxes };
}

export async function fetchWebpage(
  targetUrl: string,
  config: WebSearchConfig,
  log: Logger,
): Promise<FetchWebpageResponse> {
  const params = new URLSearchParams({ ...commonParams(config), url: targetUrl, format: "markdown" });
  const url = `${buildBaseUrl(config)}/fetch?${params.toString()}`;
  const data = await miyamiFetch(log, url, 30000);
  const title = (data.metadata as any)?.title || (data.url as string) || targetUrl;
  const content = (data.content as string) || "";
  const wordCount = (data.stats as any)?.word_count || 0;
  log.info(`Fetched ${targetUrl}: ${wordCount} words`);
  return { url: (data.url as string) || targetUrl, title, content, wordCount };
}

export async function searchAndFetchApi(
  query: string,
  config: WebSearchConfig,
  log: Logger,
  numResults = 3,
): Promise<SearchAndFetchResult> {
  const params = new URLSearchParams({
    ...commonParams(config),
    query,
    num_results: String(Math.min(Math.max(numResults, 1), 5)),
    format: "markdown",
  });
  const url = `${buildBaseUrl(config)}/search-and-fetch?${params.toString()}`;
  const data = await miyamiFetch(log, url, 60000);
  const results = ((data.results as any[]) || []).map((r) => ({
    title: r.search_result?.title || "",
    url: r.search_result?.url || "",
    snippet: r.search_result?.snippet || "",
    content: r.fetched_content?.content || "",
    wordCount: r.fetched_content?.word_count || 0,
    fetchStatus: r.fetch_status || "unknown",
  }));
  log.info(`Search-and-fetch for "${query}": ${results.length} results`);
  return { query, results };
}

export async function deepResearchApi(
  queries: string[],
  config: WebSearchConfig,
  log: Logger,
): Promise<DeepResearchResponse> {
  const params = new URLSearchParams({ ...commonParams(config), queries: queries.join(","), breadth: "3" });
  const url = `${buildBaseUrl(config)}/deep-research?${params.toString()}`;
  const data = await miyamiFetch(log, url, 120000);
  const compiledReport = (data.compiled_report as string) || "";
  const totalResults = (data.research_summary as any)?.total_results_found || 0;
  const successfulFetches = (data.research_summary as any)?.total_successful_fetches || 0;
  log.info(`Deep research for [${queries.join(", ")}]: ${totalResults} results, ${successfulFetches} fetched`);
  return { queries, compiledReport, totalResults, successfulFetches };
}

export async function crawlSiteApi(
  startUrl: string,
  config: WebSearchConfig,
  log: Logger,
  maxPages = 5,
  maxDepth = 1,
): Promise<CrawlSiteResponse> {
  const params = new URLSearchParams({
    ...commonParams(config),
    start_url: startUrl,
    max_pages: String(Math.min(Math.max(maxPages, 1), 200)),
    max_depth: String(Math.min(Math.max(maxDepth, 0), 5)),
    format: "markdown",
  });
  const url = `${buildBaseUrl(config)}/crawl-site?${params.toString()}`;
  const data = await miyamiFetch(log, url, 120000);
  const pages = ((data.pages as any[]) || []).map((p) => ({
    url: p.url || "",
    title: p.metadata?.title || "",
    content: p.content || "",
    wordCount: p.word_count || 0,
    depth: p.depth || 0,
  }));
  const pagesCrawled = (data.crawl_summary as any)?.pages_crawled || pages.length;
  const totalWords = (data.total_words as number) || 0;
  log.info(`Crawled ${startUrl}: ${pagesCrawled} pages, ${totalWords} total words`);
  return { startUrl, pagesCrawled, pages, totalWords };
}

const MAX_CONTENT_LENGTH = 4000;

export function formatSearchResults(query: string, searches: WebSearchResponse[]): string {
  const parts: string[] = [];
  const allResults: WebSearchResult[] = [];
  const allAnswers: string[] = [];
  const allSuggestions: string[] = [];
  for (const search of searches) {
    allResults.push(...search.results);
    allAnswers.push(...search.answers);
    allSuggestions.push(...search.suggestions);
  }
  if (allAnswers.length > 0) parts.push(`Quick answers: ${allAnswers.join("; ")}`);
  for (let i = 0; i < allResults.length; i++) {
    const r = allResults[i]!;
    parts.push(`${i + 1}. ${r.title}\n   ${r.url}\n   ${truncate(r.description, 300)}`);
  }
  if (allSuggestions.length > 0) parts.push(`Related searches: ${allSuggestions.slice(0, 3).join(", ")}`);
  if (parts.length === 0) return `[SEARCH RESULTS FOR: "${query}"]\nNo results found.`;
  return `[SEARCH RESULTS FOR: "${query}"]\n${parts.join("\n\n")}`;
}

export function formatFetchResult(result: FetchWebpageResponse): string {
  return `[FETCHED WEBPAGE: ${result.title}]\nURL: ${result.url}\nWord count: ${result.wordCount}\n\n${truncate(result.content, MAX_CONTENT_LENGTH)}`;
}

export function formatSearchAndFetchResult(result: SearchAndFetchResult): string {
  const parts: string[] = [];
  for (const r of result.results) {
    if (r.fetchStatus === "success" && r.content)
      parts.push(`${r.title}\nURL: ${r.url}\n${truncate(r.content, MAX_CONTENT_LENGTH)}`);
    else parts.push(`${r.title}\nURL: ${r.url}\n(fetch failed: ${r.fetchStatus})`);
  }
  if (parts.length === 0) return `[SEARCH-AND-FETCH FOR: "${result.query}"]\nNo usable results.`;
  return `[SEARCH-AND-FETCH FOR: "${result.query}"]\n${parts.join("\n\n---\n\n")}`;
}

export function formatDeepResearchResult(result: DeepResearchResponse): string {
  const report = truncate(result.compiledReport, MAX_CONTENT_LENGTH * 2);
  return `[DEEP RESEARCH FOR: ${result.queries.join(", ")}]\nResults found: ${result.totalResults} | Fetched: ${result.successfulFetches}\n\n${report}`;
}

export function formatCrawlResult(result: CrawlSiteResponse): string {
  const parts = result.pages.slice(0, 10).map((p, i) => {
    return `${i + 1}. ${p.title}\n   URL: ${p.url} (depth ${p.depth}, ${p.wordCount} words)\n   ${truncate(p.content, 800)}`;
  });
  return `[CRAWL OF ${result.startUrl}]\nPages crawled: ${result.pagesCrawled} | Total words: ${result.totalWords}\n\n${parts.join("\n\n---\n\n")}`;
}
