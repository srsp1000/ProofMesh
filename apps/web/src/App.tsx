export function App() {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>ProofMesh Governance Dashboard</h1>
      <p>Integration-first evidence-to-decision governance platform for AI applications.</p>
      <div
        style={{ marginTop: '1rem', padding: '1rem', background: '#f4f4f5', borderRadius: '6px' }}
      >
        <h3>Platform Status</h3>
        <ul>
          <li>
            <strong>Authoritative State:</strong> Protected
          </li>
          <li>
            <strong>Multi-Tenant Isolation:</strong> Enforced (RLS)
          </li>
          <li>
            <strong>Audit Trail:</strong> Append-Only & Immutable
          </li>
        </ul>
      </div>
    </div>
  );
}
