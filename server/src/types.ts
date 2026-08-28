export type AppRole = "admin" | "employer" | "agent" | "readonly";

export type AppEnv = {
  Variables: {
    authMethod?: string;
    authenticated?: boolean;
    agentId?: string;
    walletAddress?: string;
    scope?: string;
    role?: AppRole;
    requestBodySha256?: string;
  };
};
