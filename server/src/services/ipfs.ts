/**
 * IPFS Service — Store and retrieve task specs on IPFS
 * Uses local Kubo node, falls back to Pinata for pinning
 */

interface IPFSConfig {
  kuboApiUrl: string;
  gatewayUrl: string;
  pinataApiKey?: string;
  pinataSecretKey?: string;
}

const config: IPFSConfig = {
  kuboApiUrl: process.env.IPFS_API_URL || "http://localhost:5001",
  gatewayUrl: process.env.IPFS_GATEWAY_URL || "http://localhost:8080",
  pinataApiKey: process.env.PINATA_API_KEY,
  pinataSecretKey: process.env.PINATA_SECRET_KEY,
};

class IPFSService {
  /**
   * Upload JSON data to IPFS, returns CID
   */
  async upload(data: object): Promise<string> {
    const content = JSON.stringify(data, null, 2);
    const blob = new Blob([content], { type: "application/json" });
    const formData = new FormData();
    formData.append("file", blob, "spec.json");

    // Upload to local Kubo node
    const res = await fetch(`${config.kuboApiUrl}/api/v0/add?pin=true`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error(`IPFS upload failed: ${res.status}`);

    const result = await res.json();
    const cid = result.Hash;

    // Pin to Pinata if configured (remote persistence)
    if (config.pinataApiKey) {
      await this.pinToPinata(cid, data);
    }

    console.log(`[IPFS] Uploaded: ${cid}`);
    return cid;
  }

  /**
   * Upload a task spec — returns CID and spec hash for on-chain reference
   */
  async uploadTaskSpec(taskId: string, spec: object): Promise<{ cid: string; specHash: string }> {
    const envelope = {
      version: "2.0",
      taskId,
      spec,
      uploadedAt: new Date().toISOString(),
      platform: "aiwork",
    };

    const cid = await this.upload(envelope);
    // Convert CID to bytes32 for smart contract storage
    const specHash = "0x" + Buffer.from(cid).toString("hex").padEnd(64, "0");

    return { cid, specHash };
  }

  /**
   * Retrieve data from IPFS by CID
   */
  async get(cid: string): Promise<any> {
    const res = await fetch(`${config.gatewayUrl}/ipfs/${cid}`);
    if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status}`);
    return res.json();
  }

  /**
   * Get task spec by CID
   */
  async getTaskSpec(cid: string): Promise<any> {
    const data = await this.get(cid);
    return data.spec || data;
  }

  /**
   * Pin to Pinata for remote redundancy
   */
  private async pinToPinata(cid: string, metadata: object): Promise<void> {
    if (!config.pinataApiKey || !config.pinataSecretKey) return;

    try {
      await fetch("https://api.pinata.cloud/pinning/pinByHash", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          pinata_api_key: config.pinataApiKey,
          pinata_secret_api_key: config.pinataSecretKey,
        },
        body: JSON.stringify({
          hashToPin: cid,
          pinataMetadata: {
            name: `aiwork-spec-${Date.now()}`,
          },
        }),
      });
      console.log(`[IPFS] Pinned to Pinata: ${cid}`);
    } catch (err) {
      console.warn(`[IPFS] Pinata pin failed (non-critical): ${err}`);
    }
  }

  /**
   * Check if IPFS node is healthy
   */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${config.kuboApiUrl}/api/v0/id`, { method: "POST" });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const ipfs = new IPFSService();
