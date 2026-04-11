import { useState, useEffect, useCallback } from 'react'
import { createPublicClient, http, erc20Abi } from 'viem'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import './App.css'

const kit = new AppKit()

// Chain configs for balance fetching
const CHAIN_CONFIGS = {
  Ethereum_Sepolia: {
    id: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrl: 'https://sepolia.drpc.org',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  Arc_Testnet: {
    id: 5042002,
    name: 'Arc Testnet',
    rpcUrl: 'https://rpc.testnet.arc.network/',
    usdcAddress: '0x3600000000000000000000000000000000000000',
  },
}

async function fetchUsdcBalance(chainKey, address) {
  const cfg = CHAIN_CONFIGS[chainKey]
  const client = createPublicClient({
    chain: { id: cfg.id, name: cfg.name, nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [cfg.rpcUrl] } } },
    transport: http(cfg.rpcUrl),
  })
  const raw = await client.readContract({
    address: cfg.usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address],
  })
  const decimals = await client.readContract({
    address: cfg.usdcAddress,
    abi: erc20Abi,
    functionName: 'decimals',
  })
  const divisor = 10n ** BigInt(decimals)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(Number(decimals), '0').slice(0, 2)
  return `${whole}.${fracStr}`
}

// Hook: fetch USDC balance on a given chain whenever adapter changes
function useUsdcBalance(adapter, chainKey) {
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!adapter) { setBalance(null); return }
    setLoading(true)
    try {
      const address = await adapter.getAddress()
      const bal = await fetchUsdcBalance(chainKey, address)
      setBalance(bal)
    } catch {
      setBalance('—')
    } finally {
      setLoading(false)
    }
  }, [adapter, chainKey])

  useEffect(() => { refresh() }, [refresh])

  return { balance, loading, refresh }
}

function BalanceBadge({ balance, loading, chainName }) {
  return (
    <div className="balance-badge">
      <span className="balance-label">{chainName} balance</span>
      <span className="balance-value">
        {loading ? <span className="spinner spinner-dark" /> : balance !== null ? `${balance} USDC` : '—'}
      </span>
    </div>
  )
}

function WalletConnect({ adapter, onConnect, onDisconnect }) {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')

  async function connect() {
    if (!window.ethereum) {
      setError('No wallet detected. Please install MetaMask.')
      return
    }
    setConnecting(true)
    setError('')
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' })
      const viemAdapter = await createViemAdapterFromProvider({
        provider: window.ethereum,
      })
      onConnect(viemAdapter)
    } catch (e) {
      setError(e.message || 'Failed to connect wallet')
    } finally {
      setConnecting(false)
    }
  }

  if (adapter) {
    return (
      <div className="wallet-connected">
        <span className="wallet-dot" />
        <span className="wallet-label">Wallet Connected</span>
        <button className="btn btn-ghost btn-sm" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="wallet-section">
      <button className="btn btn-primary" onClick={connect} disabled={connecting}>
        {connecting ? <span className="spinner" /> : null}
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

const CHAIN_META = {
  Ethereum_Sepolia: { label: 'Ethereum Sepolia', icon: '⟠', cls: 'chain-eth' },
  Arc_Testnet:      { label: 'Arc Testnet',      icon: '◈', cls: 'chain-arc' },
}

function BridgeTab({ adapter }) {
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [swapped, setSwapped] = useState(false)

  const sourceChain = swapped ? 'Arc_Testnet' : 'Ethereum_Sepolia'
  const destChain   = swapped ? 'Ethereum_Sepolia' : 'Arc_Testnet'

  const srcMeta  = CHAIN_META[sourceChain]
  const destMeta = CHAIN_META[destChain]

  const { balance, loading: balLoading, refresh: refreshBalance } = useUsdcBalance(adapter, sourceChain)

  async function handleBridge() {
    if (!adapter) return
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      setStatus({ type: 'error', msg: 'Enter a valid USDC amount.' })
      return
    }
    setLoading(true)
    setStatus({ type: 'info', msg: 'Initiating bridge transfer…' })
    setTxHash('')
    try {
      const result = await kit.bridge({
        from: { adapter, chain: sourceChain },
        to: { adapter, chain: destChain },
        amount,
        token: 'USDC',
      })
      if (result.state === 'complete') {
        const hash = result.steps?.find(s => s.hash)?.hash || ''
        setTxHash(hash)
        setStatus({ type: 'success', msg: 'Bridge completed successfully!' })
        refreshBalance()
      } else if (result.state === 'error') {
        setStatus({ type: 'error', msg: 'Bridge failed. Please try again.' })
      } else {
        setStatus({ type: 'info', msg: `Bridge state: ${result.state}` })
      }
    } catch (e) {
      setStatus({ type: 'error', msg: e.message || 'Bridge transaction failed.' })
    } finally {
      setLoading(false)
    }
  }

  const explorerBase = sourceChain === 'Arc_Testnet'
    ? 'https://testnet.arcscan.app/tx/'
    : 'https://sepolia.etherscan.io/tx/'

  return (
    <div className="tab-content">
      {/* Balance */}
      {adapter && (
        <BalanceBadge balance={balance} loading={balLoading} chainName={srcMeta.label} />
      )}

      {/* Route with swap button */}
      <div className="route-display">
        <div className={`chain-badge ${srcMeta.cls}`}>
          <span className="chain-icon">{srcMeta.icon}</span>
          <div>
            <div className="chain-name">{srcMeta.label}</div>
            <div className="chain-sub">Source Chain</div>
          </div>
        </div>

        <button
          className="swap-btn"
          onClick={() => { setSwapped(s => !s); setStatus(null); setTxHash('') }}
          title="Swap direction"
          disabled={loading}
        >
          ⇄
        </button>

        <div className={`chain-badge ${destMeta.cls}`}>
          <span className="chain-icon">{destMeta.icon}</span>
          <div>
            <div className="chain-name">{destMeta.label}</div>
            <div className="chain-sub">Destination Chain</div>
          </div>
        </div>
      </div>

      <div className="info-box">
        <div className="info-row">
          <span>Protocol</span><span>CCTP v2</span>
        </div>
        <div className="info-row">
          <span>Token</span><span>USDC</span>
        </div>
        <div className="info-row">
          <span>Speed</span><span>Fast (~1 min)</span>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Amount (USDC)</label>
        <div className="input-wrapper">
          <input
            className="form-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={loading || !adapter}
          />
          <span className="input-badge">USDC</span>
        </div>
      </div>

      {!adapter && (
        <p className="hint-text">Connect your wallet to bridge USDC.</p>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleBridge}
        disabled={loading || !adapter || !amount}
      >
        {loading ? <><span className="spinner" /> Processing…</> : `Bridge USDC ${srcMeta.icon} → ${destMeta.icon}`}
      </button>

      {status && (
        <div className={`status-card status-${status.type}`}>
          <span className="status-icon">
            {status.type === 'success' ? '✓' : status.type === 'error' ? '✕' : 'ℹ'}
          </span>
          {status.msg}
        </div>
      )}

      {txHash && (
        <div className="tx-hash">
          <span className="tx-label">Transaction:</span>
          <a href={`${explorerBase}${txHash}`} target="_blank" rel="noreferrer" className="tx-link">
            {txHash.slice(0, 10)}…{txHash.slice(-8)}
          </a>
        </div>
      )}
    </div>
  )
}

function SendTab({ adapter }) {
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [txHash, setTxHash] = useState('')

  const { balance, loading: balLoading, refresh: refreshBalance } = useUsdcBalance(adapter, 'Arc_Testnet')

  async function handleSend() {
    if (!adapter) return
    if (!recipient || !recipient.startsWith('0x') || recipient.length !== 42) {
      setStatus({ type: 'error', msg: 'Enter a valid Ethereum address (0x…).' })
      return
    }
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      setStatus({ type: 'error', msg: 'Enter a valid USDC amount.' })
      return
    }
    setLoading(true)
    setStatus({ type: 'info', msg: 'Sending USDC on Arc Testnet…' })
    setTxHash('')
    try {
      const result = await kit.send({
        from: { adapter, chain: 'Arc_Testnet' },
        to: recipient,
        amount,
        token: 'USDC',
      })
      const hash = result?.hash || ''
      setTxHash(hash)
      setStatus({ type: 'success', msg: 'USDC sent successfully!' })
      refreshBalance()
    } catch (e) {
      setStatus({ type: 'error', msg: e.message || 'Send transaction failed.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="tab-content">
      {/* Balance */}
      {adapter && (
        <BalanceBadge balance={balance} loading={balLoading} chainName="Arc Testnet" />
      )}

      <div className="chain-badge chain-arc chain-full">
        <span className="chain-icon">◈</span>
        <div>
          <div className="chain-name">Arc Testnet</div>
          <div className="chain-sub">USDC Transfer</div>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Recipient Address</label>
        <input
          className="form-input"
          type="text"
          placeholder="0x..."
          value={recipient}
          onChange={e => setRecipient(e.target.value)}
          disabled={loading || !adapter}
        />
      </div>

      <div className="form-group">
        <label className="form-label">Amount (USDC)</label>
        <div className="input-wrapper">
          <input
            className="form-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            disabled={loading || !adapter}
          />
          <span className="input-badge">USDC</span>
        </div>
      </div>

      {!adapter && (
        <p className="hint-text">Connect your wallet to send USDC.</p>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleSend}
        disabled={loading || !adapter || !recipient || !amount}
      >
        {loading ? <><span className="spinner" /> Sending…</> : 'Send USDC'}
      </button>

      {status && (
        <div className={`status-card status-${status.type}`}>
          <span className="status-icon">
            {status.type === 'success' ? '✓' : status.type === 'error' ? '✕' : 'ℹ'}
          </span>
          {status.msg}
        </div>
      )}

      {txHash && (
        <div className="tx-hash">
          <span className="tx-label">Transaction:</span>
          <a
            href={`https://testnet.arcscan.app/tx/${txHash}`}
            target="_blank"
            rel="noreferrer"
            className="tx-link"
          >
            {txHash.slice(0, 10)}…{txHash.slice(-8)}
          </a>
        </div>
      )}
    </div>
  )
}

const TABS = ['Bridge', 'Send']

export default function App() {
  const [activeTab, setActiveTab] = useState('Bridge')
  const [adapter, setAdapter] = useState(null)

  return (
    <div className="app-bg">
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <div className="logo-icon">◈</div>
            <div>
              <div className="logo-title">Arc Payment Hub</div>
              <div className="logo-sub">Powered by Circle AppKit</div>
            </div>
          </div>
          <WalletConnect
            adapter={adapter}
            onConnect={setAdapter}
            onDisconnect={() => setAdapter(null)}
          />
        </header>

        <main className="card">
          <div className="tab-bar">
            {TABS.map(tab => (
              <button
                key={tab}
                className={`tab-btn ${activeTab === tab ? 'tab-active' : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'Bridge' ? '⇄ Bridge' : '↗ Send'}
              </button>
            ))}
          </div>

          {activeTab === 'Bridge' && <BridgeTab adapter={adapter} />}
          {activeTab === 'Send' && <SendTab adapter={adapter} />}
        </main>

        <footer className="app-footer">
          Arc Testnet · USDC · CCTP v2 · Circle AppKit · Built by Maje
        </footer>
      </div>
    </div>
  )
}
