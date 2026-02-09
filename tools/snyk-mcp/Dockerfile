FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tini python3 python3-pip python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g snyk@latest

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV SNYK_TOKEN=""
EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["python3", "server.py"]
