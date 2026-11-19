# The donor image ships sandbox-shim, which Files from @cloudflare/sandbox runs in the container.
# Keep its tag equal to the installed @cloudflare/sandbox version.
ARG SANDBOX_TOOLS_IMAGE=docker.io/cloudflare/sandbox:1.0.3
FROM ${SANDBOX_TOOLS_IMAGE} AS sandbox-tools

FROM oven/bun:1.4.4-debian
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git coreutils \
  && rm -rf /var/lib/apt/lists/*
# The published tsmodel, the same one `bunx @tsmodel/tsmodel` runs. Specs need nothing else
# installed: their `@tsmodel/tsmodel` imports (or `@leostera/feynman`, from before the rename)
# resolve to this installation.
ARG TSMODEL_VERSION=0.17.0
RUN mkdir -p /opt/tsmodel \
  && cd /opt/tsmodel \
  && echo '{"private":true}' > package.json \
  && bun add "@tsmodel/tsmodel@${TSMODEL_VERSION}" \
  && ln -s /opt/tsmodel/node_modules/@tsmodel/tsmodel/bin/tsmodel.ts /usr/local/bin/tsmodel
COPY --from=sandbox-tools /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim
RUN mkdir -p /workspace
WORKDIR /workspace
CMD ["sleep", "infinity"]
