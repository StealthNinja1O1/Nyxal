// recursive (web search) + async (comfyui image gen) commands, mcp soon

import {
  searchWeb,
  fetchWebpage,
  searchAndFetchApi,
  deepResearchApi,
  crawlSiteApi,
  formatSearchResults,
  formatFetchResult,
  formatSearchAndFetchResult,
  formatDeepResearchResult,
  formatCrawlResult,
} from "../api/websearch";
import { generateImage } from "../api/comfyui";
import type { CommandDef, AsyncCommandResult } from "./registry";

type RecursiveResult = string;

export const webSearchCommand: CommandDef<{ query: string }, RecursiveResult> = {
  name: "webSearch",
  args: { query: "string" },
  description: `Search the web for information using a search engine. Use this when you need factual information you are not sure about, need to look something up, or want to verify facts. Your reply before this command will be sent first, then you will receive search results and can give an informed follow-up answer.`,
  kind: "recursive",
  defaultEnabled: (config) => !!config.websearch.baseUrl,
  execute: async (args, ctx) => {
    const { query } = args as { query: string };
    if (!query) throw new Error("Missing query");
    const result = await searchWeb(query, ctx.config.websearch, ctx.log);
    return formatSearchResults(query, [result]);
  },
};

export const fetchWebpageCommand: CommandDef<{ url: string }, RecursiveResult> = {
  name: "fetchWebpage",
  args: { url: "string" },
  description: `Fetch and extract the full content of a specific webpage in markdown format. Use when you have a URL and need the actual page content, not just a search snippet. Good for reading articles, documentation, or reference pages.`,
  kind: "recursive",
  defaultEnabled: (config) => !!config.websearch.baseUrl,
  execute: async (args, ctx) => {
    const { url } = args as { url: string };
    if (!url) throw new Error("Missing url");
    const result = await fetchWebpage(url, ctx.config.websearch, ctx.log);
    return formatFetchResult(result);
  },
};

export const searchAndFetchCommand: CommandDef<{ query: string; num_results?: number }, RecursiveResult> = {
  name: "searchAndFetch",
  args: { query: "string", num_results: "number (1-5, default 3)" },
  description: `Search the web AND fetch full page content from the top results. More thorough than webSearch (which only returns snippets). Use when you need detailed information from multiple sources. Slower but much more comprehensive.`,
  kind: "recursive",
  defaultEnabled: (config) => !!config.websearch.baseUrl,
  execute: async (args, ctx) => {
    const { query, num_results } = args as { query: string; num_results?: number };
    if (!query) throw new Error("Missing query");
    const numResults = num_results ? Math.min(Math.max(num_results, 1), 5) : 3;
    const result = await searchAndFetchApi(query, ctx.config.websearch, ctx.log, numResults);
    return formatSearchAndFetchResult(result);
  },
};

export const deepResearchCommand: CommandDef<{ queries: string[] }, RecursiveResult> = {
  name: "deepResearch",
  args: { queries: ["query1", "query2", "..."] },
  description: `Perform deep multi-query research in parallel. Provide up to 10 search queries and get a compiled research report. Best for complex topics that need multiple angles. Slowest but most thorough option.`,
  kind: "recursive",
  defaultEnabled: (config) => !!config.websearch.baseUrl,
  execute: async (args, ctx) => {
    const { queries } = args as { queries: string[] };
    if (!queries || !Array.isArray(queries) || queries.length === 0)
      throw new Error("Missing or invalid queries array");
    const result = await deepResearchApi(queries.slice(0, 10), ctx.config.websearch, ctx.log);
    return formatDeepResearchResult(result);
  },
};

export const crawlSiteCommand: CommandDef<
  { start_url: string; max_pages?: number; max_depth?: number },
  RecursiveResult
> = {
  name: "crawlSite",
  args: { start_url: "string", max_pages: "number (1-200, default 5)", max_depth: "number (0-5, default 1)" },
  description: `Crawl an entire website recursively and extract content from multiple pages. Use for documentation sites, wikis, or when you need comprehensive info from a single source. Very slow, use only when really needed.`,
  kind: "recursive",
  defaultEnabled: (config) => !!config.websearch.baseUrl,
  execute: async (args, ctx) => {
    const { start_url, max_pages, max_depth } = args as {
      start_url: string;
      max_pages?: number;
      max_depth?: number;
    };
    if (!start_url) throw new Error("Missing start_url");
    const maxPages = max_pages ? Math.min(Math.max(max_pages, 1), 200) : 5;
    const maxDepth = max_depth ? Math.min(Math.max(max_depth, 0), 5) : 1;
    const result = await crawlSiteApi(start_url, ctx.config.websearch, ctx.log, maxPages, maxDepth);
    return formatCrawlResult(result);
  },
};

export const generateImageCommand: CommandDef<
  { prompt: string; orientation?: string; workflow?: string },
  AsyncCommandResult
> = {
  name: "generateImage",
  args: {
    prompt: "string",
    orientation: "string (one of the available orientations, default: the first)",
    workflow: "string (optional, one of the available workflow names, default: the default workflow)",
  },
  description: `Generate an image using the image generator. Provide a descriptive prompt and choose orientation. The image will be sent as a follow-up message. Use Booru style tags like "1girl, smile, blue hair, medium breasts, cowboy shot, dark, simple background" etc. natural language does not work as well.`,
  kind: "async",
  defaultEnabled: (config) => !!config.comfyui.baseUrl && config.comfyuiWorkflowIds.length > 0,
  execute: async (args, ctx) => {
    const { prompt, orientation, workflow } = args as {
      prompt: string;
      orientation?: string;
      workflow?: string;
    };
    if (!prompt || typeof prompt !== "string")
      return { success: false, message: "Invalid prompt argument for generateImage" };

    // pick workflow by name (case-insensitive); fall back to default + warn.
    let template = ctx.config.comfyuiDefaultWorkflow;
    let workflowLabel = "(default)";
    if (workflow) {
      const match = ctx.config.comfyuiWorkflows.find(
        (w) => w.name.toLowerCase() === workflow.toLowerCase(),
      );
      if (match) {
        template = match.content;
        workflowLabel = match.name;
      } else {
        ctx.log.warn(
          `generateImage: unknown workflow "${workflow}", falling back to default. Available: ${ctx.config.comfyuiWorkflows.map((w) => w.name).join(", ") || "(none)"}`,
        );
      }
    }

    try {
      const result = await generateImage(ctx.config.comfyui, ctx.log, prompt, orientation, template);
      return {
        success: true,
        message: `Image generated (orientation: ${orientation ?? "(default)"}, workflow: ${workflowLabel}): "${prompt}"`,
        attachment: { buffer: result.buffer, name: result.filename },
        prompt,
        orientation: orientation ?? "(default)",
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate image: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
