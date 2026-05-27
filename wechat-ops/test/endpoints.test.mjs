import test from "node:test";
import assert from "node:assert/strict";
import { getEndpoint, listEndpoints } from "../src/endpoints.mjs";

test("includes official account article analytics endpoints", () => {
  assert.equal(getEndpoint("official.article-summary").path, "/datacube/getarticlesummary");
  assert.equal(getEndpoint("official.article-total").path, "/datacube/getarticletotal");
});

test("includes mini program analytics endpoints", () => {
  assert.equal(getEndpoint("mini.daily-visit-trend").path, "/datacube/getweanalysisappiddailyvisittrend");
  assert.equal(getEndpoint("mini.visit-page").path, "/datacube/getweanalysisappidvisitpage");
});

test("listEndpoints exposes names and descriptions", () => {
  const endpoints = listEndpoints();
  assert.ok(endpoints.length >= 10);
  assert.ok(endpoints.every(endpoint => endpoint.name && endpoint.description && endpoint.path));
});
