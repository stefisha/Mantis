import { api } from "./api.js";
import { mountProductDemo } from "./product-demo.js";

mountProductDemo({
  root: document,
  request: api,
  matchMedia: (query) => window.matchMedia(query),
});
