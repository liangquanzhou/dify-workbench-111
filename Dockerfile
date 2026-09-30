# Modified for Dify Workbench 1.11.1 on 2026-09-30; see NOTICE and MODIFICATIONS.md.
# Legacy profile is stdio-only. Runtime image construction itself is not verified here.
FROM node:24-alpine
ENV NODE_ENV=production DIFYWF_PROFILE=dify-1.11.1
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
USER node
CMD ["node", "bin/difywf.js", "mcp"]
