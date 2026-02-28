# syntax=docker/dockerfile:1
# Build stage — install Snyk CLI and Python dependencies
FROM dhi.io/node:24-debian13-dev AS snyk-builder

RUN npm install -g snyk@latest

# Python deps stage
FROM dhi.io/python:3.13-debian13-dev AS py-builder

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Runtime stage — minimal DHI Python image with Snyk binary
FROM dhi.io/python:3.13-debian13 AS runtime

# Copy Snyk CLI from node builder
COPY --from=snyk-builder /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=snyk-builder /usr/local/bin/snyk /usr/local/bin/snyk
COPY --from=snyk-builder /usr/local/bin/node /usr/local/bin/node
COPY --from=py-builder /opt/venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"
ENV SNYK_TOKEN=""

WORKDIR /app
COPY server.py .

RUN useradd -r -s /bin/false -d /nonexistent appuser

EXPOSE 8000
USER appuser
CMD ["python3", "server.py"]
