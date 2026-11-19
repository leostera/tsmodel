// feynman.leostera.dev is tsmodel.leostera.dev now: the same path and query, moved for good.
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.host = "tsmodel.leostera.dev";
    return Response.redirect(url.toString(), 301);
  },
};
