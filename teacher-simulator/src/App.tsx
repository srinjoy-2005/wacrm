import { useState, useEffect, useRef } from 'react'

import {
  Send,
  Smartphone,
  UserPlus,
  Search,
  Lock,
  Check,
  CheckCheck,
  MoreVertical,
  Phone,
  Video,
  AlertCircle,
  Terminal,
  LogOut
} from 'lucide-react'

interface Contact {
  id: string
  name: string
  phone: string
  account_id?: string
}

interface Message {
  id: string
  conversation_id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: 'text' | 'image' | 'video' | 'audio' | 'document' | 'template' | 'location' | 'interactive'
  content_text: string | null
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  created_at: string
}

interface WebhookLog {
  timestamp: string
  type: string
  payload: unknown
  status: 'success' | 'error' | 'pending'
}

export default function App() {
  const [apiKey, setApiKey] = useState(localStorage.getItem('wacrm_api_key') || '')
  const [session, setSession] = useState<boolean>(!!localStorage.getItem('wacrm_api_key'))
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  
  const API_BASE = 'http://localhost:3000/api/v1'

  // CRM State
  const [contacts, setContacts] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  // Input fields
  const [inputText, setInputText] = useState('')
  const [newContactName, setNewContactName] = useState('')
  const [newContactPhone, setNewContactPhone] = useState('')
  const [newContactEmail, setNewContactEmail] = useState('')
  const [newContactCompany, setNewContactCompany] = useState('')
  const [newContactPreferredLanguage, setNewContactPreferredLanguage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Simulator Log State
  const [logs, setLogs] = useState<WebhookLog[]>([])
  const [activeLog, setActiveLog] = useState<WebhookLog | null>(null)

  // UI state
  const [isCreatingContact, setIsCreatingContact] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Fetch contacts when API key is active
  useEffect(() => {
    if (session) {
      loadContacts()
    } else {
      setContacts([])
      setSelectedContact(null)
      setConversationId(null)
      setMessages([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  // Fetch conversation and messages when contact changes
  useEffect(() => {
    if (selectedContact) {
      loadConversation(selectedContact)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContact])

  // Polling for messages in the active conversation
  useEffect(() => {
    if (!conversationId || !session) return

    let intervalId: ReturnType<typeof setInterval>

    const pollMessages = async () => {
      try {
        const res = await fetch(`${API_BASE}/messages?conversation_id=${conversationId}`, {
          headers: { Authorization: `Bearer ${apiKey}` }
        })
        if (res.ok) {
          const json = await res.json()
          setMessages(json.data || [])
        }
      } catch (err) {
        console.error('Failed to poll messages', err)
      }
    }

    // Poll every 1 minute to avoid spamming the logs
    intervalId = setInterval(pollMessages, 60000)
    pollMessages() // Initial fetch

    return () => clearInterval(intervalId)
  }, [conversationId, apiKey, session])

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // --- Handlers ---
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError('')
    try {
      const res = await fetch(`${API_BASE}/contacts`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      if (!res.ok) throw new Error('Invalid API Key')
      
      localStorage.setItem('wacrm_api_key', apiKey)
      setSession(true)
    } catch (err: unknown) {
      setAuthError((err as Error).message || 'Login failed')
    } finally {
      setAuthLoading(false)
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem('wacrm_api_key')
    setApiKey('')
    setSession(false)
  };

  const loadContacts = async () => {
    try {
      const res = await fetch(`${API_BASE}/contacts`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      if (!res.ok) throw new Error('Failed to load contacts')
      const json = await res.json()
      setContacts(json.data || [])
      if (json.data && json.data.length > 0 && !selectedContact) {
        setSelectedContact(json.data[0])
      }
    } catch (err) {
      console.error('Error loading contacts:', err)
    }
  };

  const loadConversation = async (contact: Contact) => {
    try {
      // Find or create conversation via API
      const res = await fetch(`${API_BASE}/conversations`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}` 
        },
        body: JSON.stringify({ contact_id: contact.id })
      })
      
      if (!res.ok) throw new Error('Failed to load/create conversation')
      const json = await res.json()
      setConversationId(json.data.id)

      // Fetch messages
      const msgsRes = await fetch(`${API_BASE}/messages?conversation_id=${json.data.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      if (msgsRes.ok) {
        const msgsJson = await msgsRes.json()
        setMessages(msgsJson.data || [])
      }
    } catch (err) {
      console.error('Error loading conversation:', err)
    }
  };

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newContactName || !newContactPhone) return

    try {
      // Basic phone normalization
      let cleanPhone = newContactPhone.replace(/\D/g, '')
      if (!cleanPhone.startsWith('+') && cleanPhone.length === 10) {
        cleanPhone = '1' + cleanPhone // Default US code, customize as needed
      }
      cleanPhone = '+' + cleanPhone

      const res = await fetch(`${API_BASE}/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          name: newContactName,
          phone: cleanPhone,
          email: newContactEmail || undefined,
          company: newContactCompany || undefined,
          preferred_language: newContactPreferredLanguage || undefined,
        })
      })

      if (!res.ok) throw new Error('Failed to create contact')
      const json = await res.json()
      const data = json.data

      setContacts((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setSelectedContact(data)
      setNewContactName('')
      setNewContactPhone('')
      setNewContactEmail('')
      setNewContactCompany('')
      setNewContactPreferredLanguage('')
      setIsCreatingContact(false)
    } catch (err: unknown) {
      alert('Error creating contact: ' + (err as Error).message)
    }
  };

  const sendMockWebhook = async (messageType: string, messagePayload: unknown) => {
    const timestamp = new Date().toISOString()
    const logIndex = logs.length

    const newLog: WebhookLog = {
      timestamp,
      type: `Inbound Message (${messageType.toUpperCase()})`,
      payload: messagePayload,
      status: 'pending'
    }

    setLogs((prev) => [newLog, ...prev])
    setActiveLog(newLog)

    try {
      const response = await fetch('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-hub-signature-256': 'sha256=mock_signature_from_local_simulator'
        },
        body: JSON.stringify(messagePayload)
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }

      setLogs((prev) =>
        prev.map((l, i) => (prev.length - 1 - i === logIndex ? { ...l, status: 'success' } : l))
      )
      newLog.status = 'success'
      setActiveLog(newLog)
    } catch (err: unknown) {
      console.error('Webhook error:', err)
      setLogs((prev) =>
        prev.map((l, i) => (prev.length - 1 - i === logIndex ? { ...l, status: 'error', error: (err as Error).message } : l))
      )
      newLog.status = 'error'
      // @ts-expect-error adding error property dynamically
      newLog.error = (err as Error).message
      setActiveLog(newLog)
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!inputText.trim() || !selectedContact || sendingMessage) return

    setSendingMessage(true)
    const textToSend = inputText.trim()
    setInputText('')

    // Standard WhatsApp Text Webhook structure
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '12345',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15555555555',
                  phone_number_id: '12345'
                },
                contacts: [
                  {
                    profile: {
                      name: selectedContact.name
                    },
                    wa_id: selectedContact.phone.replace('+', '')
                  }
                ],
                messages: [
                  {
                    from: selectedContact.phone.replace('+', ''),
                    id: `wamid.SimulatedMessage_${Math.random().toString(36).substring(2, 15)}`,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: 'text',
                    text: {
                      body: textToSend
                    }
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    }

    await sendMockWebhook('text', payload)
    setSendingMessage(false)
  };


  const triggerButtonReply = async (buttonId: string, buttonText: string) => {
    if (!selectedContact) return

    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '12345',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: '15555555555',
                  phone_number_id: '12345'
                },
                contacts: [
                  {
                    profile: { name: selectedContact.name },
                    wa_id: selectedContact.phone.replace('+', '')
                  }
                ],
                messages: [
                  {
                    from: selectedContact.phone.replace('+', ''),
                    id: `wamid.SimulatedButton_${Math.random().toString(36).substring(2, 15)}`,
                    timestamp: Math.floor(Date.now() / 1000).toString(),
                    type: 'interactive',
                    interactive: {
                      type: 'button_reply',
                      button_reply: {
                        id: buttonId,
                        title: buttonText
                      }
                    }
                  }
                ]
              },
              field: 'messages'
            }
          ]
        }
      ]
    }

    await sendMockWebhook('button_reply', payload)
  };

  // Filter contacts by search query
  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery)
  )

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-100 flex overflow-hidden font-sans">

      {/* 1. Left Panel (Identities / Accounts / Actions) */}
      <div className="w-[360px] border-r border-zinc-800 bg-zinc-900 flex flex-col shrink-0">

        {/* Header / Auth */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="size-5 text-emerald-500" />
            <h1 className="font-bold text-sm tracking-wide uppercase">WhatsApp User Sandbox</h1>
          </div>
          {session && (
            <button
              onClick={handleLogout}
              className="text-zinc-400 hover:text-red-400 transition-colors p-1.5 rounded-md hover:bg-zinc-800"
              title="Sign Out"
            >
              <LogOut className="size-4" />
            </button>
          )}
        </div>

        {/* Auth Required Screen */}
        {!session ? (
          <div className="flex-1 p-6 flex flex-col justify-center">
            <div className="text-center mb-6">
              <Lock className="size-8 mx-auto text-zinc-500 mb-2" />
              <h2 className="text-base font-semibold">Authentication Required</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Enter your Supabase dashboard credentials to load contacts and listen to live messages.
              </p>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">WACRM API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:border-emerald-500 outline-none"
                  required
                  placeholder="wk_..."
                />
              </div>
              {authError && (
                <div className="flex gap-2 bg-red-950/40 border border-red-900/60 p-2.5 rounded-lg text-xs text-red-400">
                  <AlertCircle className="size-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
              >
                {authLoading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>
        ) : (
          /* Main Contacts Sidebar */
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Create Contact Section */}
            {isCreatingContact ? (
              <form onSubmit={handleCreateContact} className="p-4 border-b border-zinc-800 bg-zinc-950/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-300">New Simulated Identity</span>
                  <button
                    type="button"
                    onClick={() => setIsCreatingContact(false)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    Cancel
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="Full Name (e.g. Alice Miller)"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-100 outline-none focus:border-emerald-500"
                  required
                />
                <input
                  type="text"
                  placeholder="Phone Number (e.g. 2025550143)"
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-100 outline-none focus:border-emerald-500"
                  required
                />
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={newContactEmail}
                  onChange={(e) => setNewContactEmail(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-100 outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Company (optional)"
                  value={newContactCompany}
                  onChange={(e) => setNewContactCompany(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-100 outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  placeholder="Preferred Language (e.g. en, es)"
                  value={newContactPreferredLanguage}
                  onChange={(e) => setNewContactPreferredLanguage(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-md text-xs text-zinc-100 outline-none focus:border-emerald-500"
                />
                <button
                  type="submit"
                  className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-xs font-semibold transition-colors"
                >
                  Create & Chat
                </button>
              </form>
            ) : (
              <div className="p-3 border-b border-zinc-800 flex gap-2">
                <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center px-2.5 py-1.5 gap-2">
                  <Search className="size-3.5 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Search mock profiles..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="bg-transparent text-xs outline-none w-full"
                  />
                </div>
                <button
                  onClick={() => setIsCreatingContact(true)}
                  className="px-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg border border-zinc-800 flex items-center justify-center text-emerald-400 transition-colors"
                  title="Create New Profile"
                >
                  <UserPlus className="size-4" />
                </button>
              </div>
            )}

            {/* Profiles List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <div className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                Simulated Sender Profiles
              </div>
              {filteredContacts.length === 0 ? (
                <div className="text-center py-8 text-xs text-zinc-500 italic">No profiles found</div>
              ) : (
                filteredContacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => setSelectedContact(contact)}
                    className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between transition-colors ${selectedContact?.id === contact.id
                        ? 'bg-emerald-600/10 border border-emerald-500/20 text-emerald-400'
                        : 'hover:bg-zinc-800 border border-transparent text-zinc-300'
                      }`}
                  >
                    <div className="truncate">
                      <div className="font-semibold text-xs truncate">{contact.name}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{contact.phone}</div>
                    </div>
                    {selectedContact?.id === contact.id && (
                      <div className="size-2 rounded-full bg-emerald-500" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2. Middle Panel (WhatsApp Phone Simulator) */}
      <div className="flex-1 bg-zinc-950 flex items-center justify-center p-6 border-r border-zinc-800 relative">
        {selectedContact ? (
          /* Phone Container Frame */
          <div className="w-[380px] h-[720px] rounded-[48px] border-[12px] border-zinc-800 bg-zinc-900 shadow-2xl flex flex-col overflow-hidden relative ring-4 ring-zinc-900/50">
            {/* Phone Speaker Notch */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-28 h-4.5 bg-zinc-800 rounded-full flex items-center justify-center z-50">
              <div className="w-10 h-1 bg-zinc-900 rounded-full" />
            </div>

            {/* WhatsApp Header */}
            <div className="pt-8 pb-3 px-4 bg-[#075e54] text-white flex items-center gap-3 shadow-md z-40 shrink-0">
              <div className="size-9 rounded-full bg-zinc-300 flex items-center justify-center text-zinc-700 font-bold text-sm uppercase shrink-0">
                {selectedContact.name.substring(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{selectedContact.name}</div>
                <div className="text-[10px] text-emerald-100 flex items-center gap-1.5 mt-0.5">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  online
                </div>
              </div>
              <div className="flex items-center gap-4 text-zinc-200">
                <Video className="size-4.5 cursor-not-allowed opacity-60" />
                <Phone className="size-4.5 cursor-not-allowed opacity-60" />
                <MoreVertical className="size-4.5 cursor-not-allowed opacity-60" />
              </div>
            </div>

            {/* Messages Area */}
            <div
              className="flex-1 overflow-y-auto p-4 space-y-2.5 z-30 flex flex-col"
              style={{
                backgroundImage: 'url("https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png")',
                backgroundSize: 'contain',
                backgroundColor: '#efeae2'
              }}
            >
              {messages.length === 0 ? (
                <div className="bg-amber-100/90 text-amber-900 text-[11px] p-2.5 rounded-lg text-center max-w-[80%] mx-auto shadow-sm border border-amber-200/40">
                  🔒 Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.
                </div>
              ) : (
                messages.map((message) => {
                  const isIncoming = message.sender_type !== 'customer'
                  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs shadow-sm relative ${isIncoming
                          ? 'bg-white text-zinc-800 self-start rounded-tl-none'
                          : 'bg-[#d9fdd3] text-zinc-900 self-end rounded-tr-none'
                        }`}
                    >
                      {/* Template badge */}
                      {message.content_type === 'template' && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-zinc-200 text-[9px] text-zinc-600 font-semibold mb-1 w-fit uppercase tracking-wide">
                          Template
                        </span>
                      )}

                      {/* Content text */}
                      <p className="whitespace-pre-wrap break-words leading-relaxed select-text">
                        {message.content_text || '[Empty Message]'}
                      </p>

                      {/* Display interactive reply buttons if any */}
                      {isIncoming && message.content_type === 'interactive' && (
                        <div className="mt-2 border-t border-zinc-100 pt-1.5 flex flex-col gap-1">
                          <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Simulate Options:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            <button
                              onClick={() => triggerButtonReply('opt_yes', 'Yes, please')}
                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-md text-[10px] font-semibold transition-colors"
                            >
                              &quot;Yes, please&quot;
                            </button>
                            <button
                              onClick={() => triggerButtonReply('opt_no', 'No, thanks')}
                              className="px-2.5 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 border border-zinc-200 rounded-md text-[10px] font-semibold transition-colors"
                            >
                              &quot;No, thanks&quot;
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Footer Info (Time + Status Checkmarks) */}
                      <div className="flex items-center justify-end gap-1 text-[9px] text-zinc-400 mt-1 select-none">
                        <span>{time}</span>
                        {!isIncoming && (
                          <span>
                            {message.status === 'read' ? (
                              <CheckCheck className="size-3.5 text-blue-500" />
                            ) : message.status === 'delivered' ? (
                              <CheckCheck className="size-3.5" />
                            ) : message.status === 'sent' ? (
                              <Check className="size-3.5" />
                            ) : message.status === 'sending' ? (
                              <span className="size-2 rounded-full border border-zinc-400 border-t-transparent animate-spin inline-block" />
                            ) : (
                              <AlertCircle className="size-3 text-red-500" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Composer Panel */}
            <form onSubmit={handleSendMessage} className="p-2.5 bg-[#f0f2f5] flex items-center gap-2 border-t border-zinc-200 z-40 shrink-0">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Type a message"
                className="flex-1 bg-white border border-transparent rounded-lg px-3 py-2 text-xs text-zinc-800 outline-none focus:border-zinc-300"
                disabled={sendingMessage}
              />
              <button
                type="submit"
                disabled={!inputText.trim() || sendingMessage}
                className="size-9 bg-[#00a884] hover:bg-[#008f72] active:bg-[#007b62] text-white rounded-full flex items-center justify-center shrink-0 disabled:opacity-50 transition-colors shadow-sm"
              >
                <Send className="size-4" />
              </button>
            </form>
          </div>
        ) : (
          <div className="text-center text-zinc-500 max-w-sm">
            <Smartphone className="size-12 mx-auto text-zinc-700 mb-3" />
            <h3 className="font-semibold text-sm">No Profile Selected</h3>
            <p className="text-xs text-zinc-500 mt-1.5">
              Select an active simulated customer profile or create a new teacher instance in the sidebar to start simulating chat sessions.
            </p>
          </div>
        )}
      </div>

      {/* 3. Right Panel (Payload Monitor Log Panel) */}
      <div className="w-[380px] border-l border-zinc-800 bg-zinc-900/40 flex flex-col shrink-0 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/60 flex items-center gap-2">
          <Terminal className="size-4.5 text-emerald-400" />
          <h2 className="font-bold text-sm tracking-wide uppercase">Sandbox Event logs</h2>
        </div>

        {/* Logs List */}
        <div className="h-[240px] overflow-y-auto border-b border-zinc-800 p-3 space-y-1 bg-zinc-950/20">
          {logs.length === 0 ? (
            <div className="text-center py-20 text-xs text-zinc-600 italic">Logs console idle. Send a message to see payloads.</div>
          ) : (
            logs.map((log, index) => (
              <button
                key={index}
                onClick={() => setActiveLog(log)}
                className={`w-full text-left p-2 rounded-md text-[10px] font-mono flex items-center justify-between border ${activeLog === log
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-200'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/30'
                  }`}
              >
                <span className="truncate flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${log.status === 'success'
                      ? 'bg-emerald-500'
                      : log.status === 'error'
                        ? 'bg-red-500'
                        : 'bg-yellow-500 animate-pulse'
                    }`} />
                  {log.type}
                </span>
                <span className="text-[9px] text-zinc-600 shrink-0">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Selected Log Inspector */}
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          <div className="px-3.5 py-2 border-b border-zinc-800 text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
            Log Inspector
          </div>
          {activeLog ? (
            <div className="flex-1 overflow-auto p-4 font-mono text-[10px] leading-relaxed space-y-3">
              <div className="flex justify-between border-b border-zinc-800 pb-1.5">
                <span className="text-zinc-500">Event Time:</span>
                <span className="text-zinc-300">{activeLog.timestamp}</span>
              </div>
              <div className="flex justify-between border-b border-zinc-800 pb-1.5">
                <span className="text-zinc-500">Status:</span>
                <span className={`font-bold ${activeLog.status === 'success'
                    ? 'text-emerald-400'
                    : activeLog.status === 'error'
                      ? 'text-red-400'
                      : 'text-yellow-400'
                  }`}>{activeLog.status.toUpperCase()}</span>
              </div>

              {/* Output raw payload JSON */}
              <div className="space-y-1">
                <div className="text-zinc-500">Webhook JSON Payload:</div>
                <pre className="p-3 bg-zinc-900/80 rounded-lg text-emerald-400 border border-zinc-800 select-all overflow-x-auto tab-size-2">
                  {JSON.stringify(activeLog.payload, null, 2)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-zinc-600 italic">
              Select an event log above to inspect the JSON payload.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
