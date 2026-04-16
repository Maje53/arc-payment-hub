import { useState, useEffect, useCallback } from 'react'
import { createPublicClient, http, erc20Abi } from 'viem'
import { AppKit } from '@circle-fin/app-kit'
import { createViemAdapterFromProvider } from '@circle-fin/adapter-viem-v2'
import './App.css'

const KIT_KEY = `KIT_KEY:${import.meta.env.VITE_KIT_KEY}`

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

  if (chainKey === 'Arc_Testnet') {
    const res = await fetch(cfg.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [address, 'latest'],
        id: 1
      })
    })
    const data = await res.json()
    if (!data.result) return '0.00'
    const raw = BigInt(data.result)
    const divisor = 10n ** 18n
    const whole = raw / divisor
    const frac = raw % divisor
    const fracStr = frac.toString().padStart(18, '0').slice(0, 2)
    return `${whole}.${fracStr}`
  }

  const res = await fetch(cfg.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [{
        to: cfg.usdcAddress,
        data: '0x70a08231000000000000000000000000' + address.slice(2).padStart(64, '0')
      }, 'latest'],
      id: 1
    })
  })
  const data = await res.json()
  if (!data.result || data.result === '0x') return '0.00'
  const raw = BigInt(data.result)
  const divisor = 10n ** 6n
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(6, '0').slice(0, 2)
  return `${whole}.${fracStr}`
}

// Hook: fetch USDC balance on a given chain whenever adapter changes
function useUsdcBalance(adapter, chainKey) {
  const [balance, setBalance] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    console.log('refresh called, adapter:', adapter)
    if (!adapter) { setBalance(null); return }
    setLoading(true)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
const address = accounts[0]
if (!address) { setBalance('-'); return }
      const bal = await fetchUsdcBalance(chainKey, address)
      setBalance(bal)
    } catch(e) {
  console.error('Balance error:', e)
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

function SwapTab({ adapter }) {
  const [amountIn, setAmountIn] = useState('')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [estimate, setEstimate] = useState(null)
  const [estimating, setEstimating] = useState(false)
  const [txHash, setTxHash] = useState('')
  const [explorerUrl, setExplorerUrl] = useState('')

  const { balance, loading: balLoading, refresh: refreshBalance } = useUsdcBalance(adapter, 'Arc_Testnet')

  // Auto-estimate when amount changes
  useEffect(() => {
    if (!adapter || !amountIn || isNaN(amountIn) || Number(amountIn) <= 0) {
      setEstimate(null)
      return
    }
    const timer = setTimeout(async () => {
      setEstimating(true)
      try {
        const est = await kit.estimateSwap({
          from: { adapter, chain: 'Arc_Testnet' },
          tokenIn: 'USDC',
          tokenOut: 'EURC',
          amountIn,
          config: { kitKey: KIT_KEY, slippageBps: 300 },
        })
        setEstimate(est)
      } catch {
        setEstimate(null)
      } finally {
        setEstimating(false)
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [adapter, amountIn])

  async function handleSwap() {
    if (!adapter) return
    if (!amountIn || isNaN(amountIn) || Number(amountIn) <= 0) {
      setStatus({ type: 'error', msg: 'Enter a valid USDC amount.' })
      return
    }
    setLoading(true)
    setStatus({ type: 'info', msg: 'Swapping USDC → EURC on Arc Testnet…' })
    setTxHash('')
    setExplorerUrl('')
    try {
      const result = await kit.swap({
        from: { adapter, chain: 'Arc_Testnet' },
        tokenIn: 'USDC',
        tokenOut: 'EURC',
        amountIn,
        config: { kitKey: KIT_KEY, slippageBps: 300 },
      })
      setTxHash(result.txHash || '')
      setExplorerUrl(result.explorerUrl || '')
      const received = result.amountOut ? `Received ${result.amountOut} EURC.` : ''
      setStatus({ type: 'success', msg: `Swap completed! ${received}` })
      refreshBalance()
    } catch (e) {
      setStatus({ type: 'error', msg: e.message || 'Swap failed.' })
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

      {/* Swap pair display */}
      <div className="swap-pair">
        <div className="swap-token-card">
          <span className="swap-token-icon usdc-icon">$</span>
          <div>
            <div className="swap-token-name">USDC</div>
            <div className="chain-sub">You pay</div>
          </div>
        </div>
        <div className="swap-pair-arrow">→</div>
        <div className="swap-token-card">
          <span className="swap-token-icon eurc-icon">€</span>
          <div>
            <div className="swap-token-name">EURC</div>
            <div className="chain-sub">You receive</div>
          </div>
        </div>
      </div>

      <div className="info-box">
        <div className="info-row">
          <span>Network</span><span>Arc Testnet</span>
        </div>
        <div className="info-row">
          <span>Slippage</span><span>3%</span>
        </div>
        <div className="info-row">
          <span>Est. output</span>
          <span>
            {estimating
              ? <span className="spinner-inline" />
              : estimate
                ? `${estimate.estimatedOutput.amount} EURC`
                : '—'}
          </span>
        </div>
        <div className="info-row">
          <span>Min. received</span>
          <span>
            {estimate ? `${estimate.stopLimit.amount} EURC` : '—'}
          </span>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Amount In (USDC)</label>
        <div className="input-wrapper">
          <input
            className="form-input"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={amountIn}
            onChange={e => { setAmountIn(e.target.value); setEstimate(null) }}
            disabled={loading || !adapter}
          />
          <span className="input-badge">USDC</span>
        </div>
      </div>

      {!adapter && (
        <p className="hint-text">Connect your wallet to swap tokens.</p>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleSwap}
        disabled={loading || !adapter || !amountIn}
      >
        {loading ? <><span className="spinner" /> Swapping…</> : 'Swap USDC → EURC'}
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
            href={explorerUrl || `https://testnet.arcscan.app/tx/${txHash}`}
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
function WalletStats({ adapter }) {
  const { balance: arcBalance, loading: arcLoading } = useUsdcBalance(adapter, 'Arc_Testnet')
  const { balance: sepBalance, loading: sepLoading } = useUsdcBalance(adapter, 'Ethereum_Sepolia')

  return (
    <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'12px', padding:'16px', margin:'16px 16px 0', display:'flex', justifyContent:'space-between' }}>
      <div>
        <div style={{ fontSize:'11px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'4px' }}>Arc Testnet Balance</div>
        <div style={{ fontSize:'22px', fontWeight:'700', color:'var(--cyan)' }}>${arcLoading ? '...' : arcBalance} USDC</div>
      </div>
      <div style={{ textAlign:'right' }}>
        <div style={{ fontSize:'11px', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Sepolia Balance</div>
        <div style={{ fontSize:'13px', color:'var(--text-secondary)', marginTop:'4px' }}>{sepLoading ? '...' : sepBalance} USDC</div>
      </div>
    </div>
  )
}
function GmCheckin({ adapter }) {
  const [checking, setChecking] = useState(false)
  const [txDays, setTxDays] = useState(new Set())
  const [todayDone, setTodayDone] = useState(false)
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const today = now.getDate()

  const monthName = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric' }).format(now)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDay = new Date(year, month, 1).getDay()
  const startOffset = (firstDay + 6) % 7

  useEffect(() => {
    if (!adapter) return
    async function loadTxDays() {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' })
        const address = accounts[0]
        if (!address) return
        const res = await fetch(`https://testnet.arcscan.app/api/v2/addresses/${address}/transactions`)
        const data = await res.json()
        const days = new Set()
        const txList = data.items || []
        txList.forEach(tx => {
          const d = new Date(tx.timestamp)
          if (d.getFullYear() === year && d.getMonth() === month) {
            days.add(d.getDate())
          }
        })
        setTxDays(days)
        setTodayDone(days.has(today))
      } catch (e) {
        console.error('GM load error:', e)
      }
    }
    loadTxDays()
  }, [adapter])

  async function handleGm() {
    if (todayDone || checking) return
    setChecking(true)
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' })
      const address = accounts[0]
      await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [{ from: address, to: address, value: '0x0' }]
      })
      setTodayDone(true)
      setTxDays(prev => new Set([...prev, today]))
    } catch (e) {
      console.error('GM tx error:', e)
    }
    setChecking(false)
  }

  return (
    <div style={{ display: 'flex', gap: '12px', margin: '16px', flexWrap: 'wrap' }}>
      {/* GM Butonu */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', flex: '0 0 140px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Günlük GM</div>
        <button
          onClick={handleGm}
          disabled={!adapter || todayDone || checking}
          style={{ background: todayDone ? '#1a3a2a' : 'linear-gradient(135deg, #00b37e, #00d4aa)', border: 'none', borderRadius: '10px', padding: '14px 20px', color: todayDone ? '#00b37e' : '#000', fontSize: '22px', fontWeight: '800', cursor: todayDone ? 'default' : 'pointer', width: '100%' }}
        >
          {checking ? '...' : todayDone ? '✓ GM!' : 'GM 🌅'}
        </button>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{todayDone ? 'Bugün tamamlandı' : 'Günlük Tx at'}</div>
      </div>

      {/* Takvim */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '16px', flex: '1', minWidth: '220px' }}>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>{monthName}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', textAlign: 'center' }}>
          {['Pt','Sa','Ça','Pe','Cu','Ct','Pz'].map(d => (
            <div key={d} style={{ fontSize: '10px', color: 'var(--text-muted)', paddingBottom: '4px' }}>{d}</div>
          ))}
          {Array(startOffset).fill(null).map((_, i) => <div key={`e${i}`} />)}
          {Array(daysInMonth).fill(null).map((_, i) => {
            const day = i + 1
            const done = txDays.has(day)
            const isToday = day === today
            return (
              <div key={day} style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', fontSize: '11px', fontWeight: isToday ? '700' : '400', background: done ? '#1a3a2a' : isToday ? 'var(--border)' : 'transparent', color: done ? '#00b37e' : isToday ? 'var(--text-primary)' : 'var(--text-muted)', position: 'relative' }}>
                {done ? '✓' : day}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
function NanoAITab() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  async function handleAsk() {
    if (!question.trim()) return
    setLoading(true)
    setAnswer('')
    setStatus({ type: 'info', msg: 'Processing...' })
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'API error')
      setAnswer(data.answer)
      setStatus({ type: 'success', msg: '$0.001 USDC paid on Arc Testnet' })
    } catch (e) {
      setStatus({ type: 'error', msg: e.message || 'Error occurred.' })
    } finally {
      setLoading(false)
    }
  }
  return (
    <div className="tab-content">
      <div className="chain-badge chain-arc chain-full">
        <span className="chain-icon">◈</span>
        <div>
          <div className="chain-name">NanoAI — Pay per Question</div>
          <div className="chain-sub">$0.001 USDC · Arc Testnet · Claude</div>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Your question</label>
        <textarea
          className="form-input"
          rows={3}
          placeholder="Example: What is Arc Testnet?"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          disabled={loading}
          style={{ resize: 'vertical', minHeight: '80px' }}
        />
      </div>
      <button
        className="btn btn-primary btn-full"
        onClick={handleAsk}
        disabled={loading || !question.trim()}
      >
        {loading ? 'Processing...' : 'Ask · $0.001 USDC'}
      </button>
      <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="btn btn-ghost btn-full" style={{ textAlign: 'center', textDecoration: 'none', color: '#f97316', borderColor: '#f97316' }}>Get testnet USDC →</a>
      {status && (
        <div className={`status-card status-${status.type}`}>
          {status.msg}
        </div>
      )}
      {answer && (
        <div className="info-box" style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '13px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
            {answer}
          </div>
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
      const hash = result?.hash || result?.txHash || result?.transactionHash || ''
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

const TABS = ['Bridge', 'Swap', 'Send', 'NanoAI']
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
          {adapter && (
            <WalletStats adapter={adapter} />
          )}
          <div className="tab-bar">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}className={`tab-btn ${activeTab === tab ? 'tab-active' : ''} ${tab === 'NanoAI' ? 'tab-nanoai' : ''}`}
              >
              {tab === 'Bridge' ? 'Bridge' : tab === 'Swap' ? 'Swap' : tab === 'Send' ? 'Send' : 'NanoAI'}</button>
            ))}
          </div>
          {activeTab === 'Bridge' && <BridgeTab adapter={adapter} />}
          {activeTab === 'Swap' && <SwapTab adapter={adapter} />}
          {activeTab === 'Send' && <SendTab adapter={adapter} />}
          {activeTab === 'NanoAI' && <NanoAITab />}
        </main>
{adapter && <GmCheckin adapter={adapter} />}
        <footer className="app-footer">
          Arc Testnet · USDC · CCTP v2 · Circle AppKit · Built by Maje
        </footer>
      </div>
    </div>
  )
}
