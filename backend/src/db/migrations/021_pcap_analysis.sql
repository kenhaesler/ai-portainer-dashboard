-- Add analysis_result column to pcap_captures for storing AI analysis JSON
ALTER TABLE pcap_captures ADD COLUMN analysis_result TEXT;
