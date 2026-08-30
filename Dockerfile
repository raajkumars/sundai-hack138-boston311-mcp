FROM nginx:alpine
COPY nginx-default.conf /etc/nginx/conf.d/default.conf
COPY index.html manifest.json sw.js mcp-client.js ollama-client.js purpose-compiler.js direct-agent.js run-metrics.js civic-normalizer.js /usr/share/nginx/html/
COPY icons /usr/share/nginx/html/icons
COPY purpose-packs /usr/share/nginx/html/purpose-packs
COPY vendor /usr/share/nginx/html/vendor
COPY models /usr/share/nginx/html/models
COPY docs /usr/share/nginx/html/docs
