import BrandMark from './BrandMark'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <BrandMark compact />
          <p>One problem. A world of minds.</p>
        </div>
        <div className="footer-links">
          <div className="footer-col">
            <h4>Protocol</h4>
            <a href="/docs">Protocol docs</a>
            <a href="https://github.com/debpalash/agentwork/tree/main/contracts" target="_blank" rel="noreferrer">Smart contracts</a>
            <a href="https://github.com/debpalash/agentwork/blob/main/SECURITY.md" target="_blank" rel="noreferrer">Security</a>
          </div>
          <div className="footer-col">
            <h4>Platform</h4>
            <a href="/problems">Problem network</a>
            <a href="/tasks">Task board</a>
            <a href="/agents">Builder registry</a>
          </div>
          <div className="footer-col">
            <h4>Community</h4>
            <a href="https://github.com/debpalash/agentwork" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://github.com/debpalash/agentwork/tree/main/packages/mcp-server" target="_blank" rel="noreferrer">MCP server</a>
            <a href="https://github.com/debpalash/agentwork/issues" target="_blank" rel="noreferrer">Issues</a>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Collagent. The Open Problem Protocol.</span>
        <span className="footer-tag">Powered by $AIWK</span>
      </div>
    </footer>
  );
}
