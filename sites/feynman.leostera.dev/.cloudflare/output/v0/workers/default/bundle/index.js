// \0virtual:cloudflare/worker-entry
var worker_entry_default = { fetch(request) {
	const url = new URL(request.url);
	url.protocol = "https:";
	url.host = "tsmodel.leostera.dev";
	return Response.redirect(url.toString(), 301);
} };
export { worker_entry_default as default };

//# sourceMappingURL=index.js.map