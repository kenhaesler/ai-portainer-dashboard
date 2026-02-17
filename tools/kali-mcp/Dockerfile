FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

# Core utilities + Python + Go + Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ca-certificates tini \
    curl wget jq vim-tiny git openssh-client socat \
    golang nodejs npm \
    && rm -rf /var/lib/apt/lists/*

# Network recon & enumeration
RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap masscan netcat-traditional dnsutils whois traceroute \
    tcpdump net-tools iproute2 iputils-ping arp-scan \
    ncat proxychains4 \
    && rm -rf /var/lib/apt/lists/*

# DNS recon & OSINT
RUN apt-get update && apt-get install -y --no-install-recommends \
    dnsrecon dnsenum cewl \
    && rm -rf /var/lib/apt/lists/*

# Web application testing
RUN apt-get update && apt-get install -y --no-install-recommends \
    nikto dirb gobuster whatweb wfuzz sqlmap \
    ffuf seclists zaproxy \
    && rm -rf /var/lib/apt/lists/*

# TLS/SSL testing
RUN apt-get update && apt-get install -y --no-install-recommends \
    testssl.sh sslscan \
    && rm -rf /var/lib/apt/lists/*

# Password & crypto
RUN apt-get update && apt-get install -y --no-install-recommends \
    john hydra hashcat wordlists crunch hash-identifier \
    && rm -rf /var/lib/apt/lists/*

# Exploitation & post-exploitation
RUN apt-get update && apt-get install -y --no-install-recommends \
    exploitdb enum4linux smbclient snmp nbtscan \
    && rm -rf /var/lib/apt/lists/*

# Container security tools (install scripts for trivy/grype, binary for hadolint)
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin \
    && curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin \
    && curl -L https://github.com/hadolint/hadolint/releases/latest/download/hadolint-Linux-arm64 -o /usr/local/bin/hadolint && chmod +x /usr/local/bin/hadolint

# Go-based tools (nuclei, dive, gitleaks)
ENV GOPATH=/opt/go
ENV PATH="$GOPATH/bin:$PATH"
RUN go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest \
    && go install github.com/wagoodman/dive@latest \
    && go install github.com/zricethezav/gitleaks/v8@latest \
    && rm -rf /root/.cache/go-build /opt/go/pkg

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY server.py /app/server.py

EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["python", "/app/server.py"]
