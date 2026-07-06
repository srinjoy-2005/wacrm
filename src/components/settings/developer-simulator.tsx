'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Terminal,
  Zap,
  CheckCircle2,
  XCircle,
  Loader2,
  User,
  MessageSquare,
  RefreshCw,
  Info,
  Clock,
  Play
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

interface SimpleContact {
  id: string;
  name: string;
  phone: string;
}

interface SimpleMessage {
  id: string;
  message_id: string | null;
  content_text: string | null;
  created_at: string;
  recipient_phone: string;
  contact_name: string;
}

export function DeveloperSimulator() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [isMock, setIsMock] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [contacts, setContacts] = useState<SimpleContact[]>([]);
  const [recentMessages, setRecentMessages] = useState<SimpleMessage[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Inbound simulation state
  const [inboundType, setInboundType] = useState<'text' | 'button_reply'>('text');
  const [selectedContactId, setSelectedContactId] = useState<string>('new');
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [buttonId, setButtonId] = useState('');
  const [buttonTitle, setButtonTitle] = useState('');
  const [sendingInbound, setSendingInbound] = useState(false);

  // Status update state
  const [selectedMessageId, setSelectedMessageId] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<'delivered' | 'read' | 'failed'>('read');
  const [sendingStatus, setSendingStatus] = useState(false);

  // Template sync state
  const [syncingTemplates, setSyncingTemplates] = useState(false);

  // Live Console state
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [activePayload, setActivePayload] = useState<string>('');

  useEffect(() => {
    checkSimulatorMode();
  }, []);

  async function checkSimulatorMode() {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/config', { method: 'GET' });
      const payload = await res.json();
      setIsMock(!!payload.is_mock);
      
      const { data: configData } = await supabase
        .from('whatsapp_config')
        .select('*')
        .maybeSingle();
      setConfig(configData);

      if (payload.is_mock) {
        await loadData();
      }
    } catch (err) {
      console.error('Failed to check simulator mode:', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadData() {
    setRefreshing(true);
    try {
      // Load contacts
      const { data: contactsData } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .order('name');
      setContacts(contactsData || []);

      // Load recent outgoing messages
      const { data: messagesData, error: msgError } = await supabase
        .from('messages')
        .select(`
          id,
          message_id,
          content_text,
          created_at,
          conversation:conversations (
            id,
            contact:contacts (
              name,
              phone
            )
          )
        `)
        .eq('sender_type', 'agent')
        .order('created_at', { ascending: false })
        .limit(10);

      if (messagesData) {
        const parsed: SimpleMessage[] = messagesData.map((m: any) => ({
          id: m.id,
          message_id: m.message_id,
          content_text: m.content_text || `[${m.content_type || 'Media'}]`,
          created_at: m.created_at,
          recipient_phone: m.conversation?.contact?.phone || 'Unknown',
          contact_name: m.conversation?.contact?.name || 'Unknown'
        }));
        setRecentMessages(parsed);
        if (parsed.length > 0 && !selectedMessageId) {
          setSelectedMessageId(parsed[0].message_id || '');
        }
      }
    } catch (err) {
      console.error('Failed to load simulator data:', err);
    } finally {
      setRefreshing(false);
    }
  }

  const addConsoleLog = (message: string, payload?: any) => {
    const timestamp = new Date().toLocaleTimeString();
    setConsoleLogs((prev) => [`[${timestamp}] ${message}`, ...prev].slice(0, 50));
    if (payload) {
      setActivePayload(JSON.stringify(payload, null, 2));
    }
  };

  async function handleSendInbound() {
    let customerPhone = '';
    let customerName = '';

    if (selectedContactId === 'new') {
      if (!newContactName.trim() || !newContactPhone.trim()) {
        toast.error('New customer name and phone number are required');
        return;
      }
      customerPhone = newContactPhone.trim();
      customerName = newContactName.trim();
    } else {
      const match = contacts.find((c) => c.id === selectedContactId);
      if (!match) {
        toast.error('Selected contact not found');
        return;
      }
      customerPhone = match.phone;
      customerName = match.name;
    }

    if (inboundType === 'text' && !messageBody.trim()) {
      toast.error('Message body is required');
      return;
    }

    if (inboundType === 'button_reply' && (!buttonId.trim() || !buttonTitle.trim())) {
      toast.error('Button ID and Title are required');
      return;
    }

    setSendingInbound(true);

    try {
      const wamid = `wamid.HBgL${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
      const unixTime = Math.floor(Date.now() / 1000).toString();

      // Shape Meta Webhook Inbound Message JSON
      const payload: any = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: config?.waba_id || 'mock-waba-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15555555555',
                    phone_number_id: config?.phone_number_id || 'mock-phone-id'
                  },
                  contacts: [
                    {
                      profile: { name: customerName },
                      wa_id: customerPhone.replace(/\+/g, '')
                    }
                  ],
                  messages: [
                    {
                      from: customerPhone.replace(/\+/g, ''),
                      id: wamid,
                      timestamp: unixTime,
                      ...(inboundType === 'text'
                        ? {
                            type: 'text',
                            text: { body: messageBody.trim() }
                          }
                        : {
                            type: 'interactive',
                            interactive: {
                              type: 'button_reply',
                              button_reply: {
                                id: buttonId.trim(),
                                title: buttonTitle.trim()
                              }
                            }
                          })
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      addConsoleLog(`POST /api/whatsapp/webhook (Inbound: ${inboundType})`, payload);

      const res = await fetch('/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const textResult = await res.text();
      let data;
      try {
        data = JSON.parse(textResult);
      } catch {
        data = textResult;
      }

      if (res.ok) {
        toast.success('Inbound message simulated successfully');
        addConsoleLog(`Response 200 OK`, data);
        setMessageBody('');
        setButtonId('');
        setButtonTitle('');
        await loadData();
      } else {
        toast.error('Simulation request failed');
        addConsoleLog(`Response Error ${res.status}`, data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Simulation connection failed');
      addConsoleLog(`Request Exception`, err instanceof Error ? err.message : err);
    } finally {
      setSendingInbound(false);
    }
  }

  async function handleSendStatusUpdate() {
    if (!selectedMessageId) {
      toast.error('Please select a message to update');
      return;
    }

    const matchedMessage = recentMessages.find((m) => m.message_id === selectedMessageId);
    if (!matchedMessage) return;

    setSendingStatus(true);

    try {
      const unixTime = Math.floor(Date.now() / 1000).toString();

      // Shape Meta Webhook Status Update JSON
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: config?.waba_id || 'mock-waba-id',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15555555555',
                    phone_number_id: config?.phone_number_id || 'mock-phone-id'
                  },
                  statuses: [
                    {
                      id: selectedMessageId,
                      status: selectedStatus,
                      timestamp: unixTime,
                      recipient_id: matchedMessage.recipient_phone.replace(/\+/g, '')
                    }
                  ]
                },
                field: 'messages'
              }
            ]
          }
        ]
      };

      addConsoleLog(`POST /api/whatsapp/webhook (Status: ${selectedStatus})`, payload);

      const res = await fetch('/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const textResult = await res.text();
      let data;
      try {
        data = JSON.parse(textResult);
      } catch {
        data = textResult;
      }

      if (res.ok) {
        toast.success(`Simulated message status updated to ${selectedStatus}`);
        addConsoleLog(`Response 200 OK`, data);
        await loadData();
      } else {
        toast.error('Simulation status update failed');
        addConsoleLog(`Response Error ${res.status}`, data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Simulation connection failed');
      addConsoleLog(`Request Exception`, err instanceof Error ? err.message : err);
    } finally {
      setSendingStatus(false);
    }
  }

  async function handleSyncTemplates() {
    setSyncingTemplates(true);
    addConsoleLog('POST /api/whatsapp/templates/sync');
    try {
      const res = await fetch('/api/whatsapp/templates/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Mock templates synced: ${data.inserted} added, ${data.updated} updated`);
        addConsoleLog(`Response 200 OK`, data);
      } else {
        toast.error(data.error || 'Failed to sync mock templates');
        addConsoleLog(`Response Error ${res.status}`, data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to trigger mock template sync');
    } finally {
      setSyncingTemplates(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WhatsApp Simulator"
          description="Simulate incoming WhatsApp messages, user replies, and delivery statuses for local testing."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  if (!isMock) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WhatsApp Simulator"
          description="Simulate incoming WhatsApp messages, user replies, and delivery statuses for local testing."
        />
        <Alert className="bg-amber-950/40 border-amber-600/40">
          <div className="flex items-start gap-3">
            <Info className="size-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <AlertTitle className="text-amber-200 mb-1">
                WhatsApp Simulator Mode Inactive
              </AlertTitle>
              <AlertDescription className="text-amber-100/80 text-sm leading-relaxed">
                The Developer Simulator is designed for local development. To activate it, set the environment variable <code className="bg-amber-900/50 px-1 py-0.5 rounded font-mono text-amber-200">MOCK_WHATSAPP=true</code> in your local <code className="font-mono">.env.local</code> file and restart the development server.
              </AlertDescription>
            </div>
          </div>
        </Alert>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200 space-y-6">
      <div className="flex items-center justify-between">
        <SettingsPanelHead
          title="WhatsApp Simulator"
          description="Simulate incoming WhatsApp messages, user replies, and delivery statuses for local testing."
        />
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={refreshing}
          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          <RefreshCw className={`size-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh Data
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Left Side Forms */}
        <div className="space-y-6">
          {/* Inbound Simulator Card */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2 text-foreground">
                <MessageSquare className="size-4 text-primary" />
                Simulate Inbound Message
              </CardTitle>
              <CardDescription>
                Simulate a customer sending a WhatsApp message or clicking an interactive reply button.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Type Select */}
              <div className="space-y-2">
                <Label className="text-muted-foreground">Message Type</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="inboundType"
                      checked={inboundType === 'text'}
                      onChange={() => setInboundType('text')}
                      className="accent-primary"
                    />
                    Text Message
                  </label>
                  <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                    <input
                      type="radio"
                      name="inboundType"
                      checked={inboundType === 'button_reply'}
                      onChange={() => setInboundType('button_reply')}
                      className="accent-primary"
                    />
                    Interactive Button Reply
                  </label>
                </div>
              </div>

              {/* Sender Select */}
              <div className="space-y-2">
                <Label className="text-muted-foreground">Sender (Customer)</Label>
                <select
                  value={selectedContactId}
                  onChange={(e) => setSelectedContactId(e.target.value)}
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="new">+ Create New Simulated Customer</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.phone})
                    </option>
                  ))}
                </select>
              </div>

              {/* New Contact Inputs */}
              {selectedContactId === 'new' && (
                <div className="grid gap-4 sm:grid-cols-2 p-3 bg-muted/40 rounded-lg border border-border/40">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Customer Name</Label>
                    <Input
                      placeholder="e.g. Alice Smith"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      className="h-9 bg-muted border-border text-foreground text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Phone Number (E.164)</Label>
                    <Input
                      placeholder="e.g. +12025550143"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      className="h-9 bg-muted border-border text-foreground text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Text Message Inputs */}
              {inboundType === 'text' ? (
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Message Text</Label>
                  <textarea
                    placeholder="Type your simulated WhatsApp message..."
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                  />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 p-3 bg-muted/40 rounded-lg border border-border/40">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Button ID (Custom payload value)</Label>
                    <Input
                      placeholder="e.g. menu_yes"
                      value={buttonId}
                      onChange={(e) => setButtonId(e.target.value)}
                      className="h-9 bg-muted border-border text-foreground text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Button Title (Visible text)</Label>
                    <Input
                      placeholder="e.g. Yes, I accept"
                      value={buttonTitle}
                      onChange={(e) => setButtonTitle(e.target.value)}
                      className="h-9 bg-muted border-border text-foreground text-sm"
                    />
                  </div>
                </div>
              )}

              <Button
                onClick={handleSendInbound}
                disabled={sendingInbound}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {sendingInbound ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Simulating Inbound...
                  </>
                ) : (
                  <>
                    <Play className="size-4 mr-2" />
                    Trigger Inbound Message
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Status Update Simulator Card */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2 text-foreground">
                <Clock className="size-4 text-primary" />
                Simulate Status Update
              </CardTitle>
              <CardDescription>
                Simulate Meta delivering a status update event (delivered, read, failed) for a sent message.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {recentMessages.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4 bg-muted/20 border border-border/40 rounded-lg">
                  No outgoing messages found to simulate status updates for. Send a message from the Inbox first!
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Select Sent Message</Label>
                    <select
                      value={selectedMessageId}
                      onChange={(e) => setSelectedMessageId(e.target.value)}
                      className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                      {recentMessages.map((m) => (
                        <option key={m.id} value={m.message_id || ''}>
                          To: {m.contact_name} ({m.recipient_phone}) - &quot;{m.content_text?.substring(0, 40)}...&quot;
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Delivery Status</Label>
                    <div className="flex gap-4">
                      {['delivered', 'read', 'failed'].map((st) => (
                        <label key={st} className="flex items-center gap-2 text-sm text-foreground cursor-pointer capitalize">
                          <input
                            type="radio"
                            name="deliveryStatus"
                            checked={selectedStatus === st}
                            onChange={() => setSelectedStatus(st as any)}
                            className="accent-primary"
                          />
                          {st}
                        </label>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleSendStatusUpdate}
                    disabled={sendingStatus}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {sendingStatus ? (
                      <>
                        <Loader2 className="size-4 animate-spin mr-2" />
                        Updating Status...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="size-4 mr-2" />
                        Simulate Status Transition
                      </>
                    )}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Quick Actions Card */}
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base text-foreground">Quick Setup Utilities</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={handleSyncTemplates}
                disabled={syncingTemplates}
                className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                {syncingTemplates ? (
                  <Loader2 className="size-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="size-4 mr-2" />
                )}
                Sync Mock Templates
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Side Live Console */}
        <div className="space-y-6">
          <Card className="h-[600px] flex flex-col border-border bg-card">
            <CardHeader className="pb-2 border-b border-border">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Terminal className="size-4 text-primary" />
                Live Hook Console
              </CardTitle>
              <CardDescription className="text-xs">
                Inspect raw payloads posted to your local webhook route.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0 flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-zinc-300 space-y-2 bg-zinc-950">
                {consoleLogs.length === 0 ? (
                  <div className="text-center py-20 text-zinc-500/70 italic">
                    Console idle. Trigger actions to inspect webhook requests.
                  </div>
                ) : (
                  consoleLogs.map((log, index) => (
                    <div key={index} className="border-l-2 border-primary/40 pl-2 py-0.5 leading-relaxed break-all">
                      {log}
                    </div>
                  ))
                )}
              </div>
              
              {activePayload && (
                <div className="h-1/2 border-t border-zinc-800 flex flex-col overflow-hidden bg-zinc-900">
                  <div className="px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/80 text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
                    Last Sent Request Payload
                  </div>
                  <pre className="flex-1 overflow-auto p-4 font-mono text-[11px] text-emerald-400 selection:bg-emerald-950 select-all leading-relaxed tab-size-2">
                    {activePayload}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
