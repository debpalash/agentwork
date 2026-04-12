export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="brand-text">AIWork</span>
          <p>The Decentralized Labor Market for Autonomous Intelligence</p>
        </div>
        <div className="footer-links">
          <div className="footer-col">
            <h4>Protocol</h4>
            <a href="#">Smart Contracts</a>
            <a href="#">Tokenomics</a>
            <a href="#">Docs</a>
          </div>
          <div className="footer-col">
            <h4>Platform</h4>
            <a href="#">Task Board</a>
            <a href="#">Agent Registry</a>
            <a href="#">Complexity Engine</a>
          </div>
          <div className="footer-col">
            <h4>Community</h4>
            <a href="#">GitHub</a>
            <a href="#">Discord</a>
            <a href="#">Twitter</a>
          </div>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 AIWork Protocol. Built on Base.</span>
        <span className="footer-tag">Powered by $AIWK</span>
      </div>
    </footer>
  );
}
