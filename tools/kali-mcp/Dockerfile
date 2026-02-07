FROM kalilinux/kali-rolling

ENV DEBIAN_FRONTEND=noninteractive

# Core utilities + Python
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip ca-certificates tini \
    curl wget jq vim-tiny git openssh-client socat \
    && rm -rf /var/lib/apt/lists/*

# Network recon & enumeration
RUN apt-get update && apt-get install -y --no-install-recommends \
    nmap masscan netcat-traditional dnsutils whois traceroute \
    tcpdump net-tools iproute2 iputils-ping arp-scan \
    && rm -rf /var/lib/apt/lists/*

# Web application testing
RUN apt-get update && apt-get install -y --no-install-recommends \
    nikto dirb gobuster whatweb wfuzz sqlmap \
    && rm -rf /var/lib/apt/lists/*

# Password & crypto
RUN apt-get update && apt-get install -y --no-install-recommends \
    john hydra hashcat wordlists crunch hash-identifier \
    && rm -rf /var/lib/apt/lists/*

# Exploitation & post-exploitation
RUN apt-get update && apt-get install -y --no-install-recommends \
    exploitdb enum4linux smbclient snmp nbtscan \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY server.py /app/server.py

EXPOSE 8000
ENTRYPOINT ["tini", "--"]
CMD ["python", "/app/server.py"]
