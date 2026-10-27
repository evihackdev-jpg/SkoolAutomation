import { EllipsisVertical, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { DataTable, type DataColumn } from '../components/DataTable';
import { Dropdown, DropdownItem } from '../components/Dropdown';
import { Modal } from '../components/Modal';
import { Notice } from '../components/Notice';
import { PageHeader } from '../components/PageHeader';
import { addAccount, listAccounts, removeAccount, updateAccountCookies, verifyAccount } from '../api/accounts';
import type { AccountRecord, AccountStatus } from '../types';
import { cn } from '../utils/format';
import { toneClasses } from '../utils/icons';

interface AccountDraft {
  cookieData: string;
}

const emptyDraft: AccountDraft = { cookieData: '' };

function StatusBadge({ status }: { status: AccountStatus }) {
  const active = status === 'active';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        active ? 'border-success/30 bg-success-bg text-success' : 'border-line bg-elevated text-ink-muted',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-success' : 'bg-ink-muted')} aria-hidden="true" />
      {status === 'unverified' ? 'Not checked' : active ? 'Connected' : 'Needs cookies'}
    </span>
  );
}

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AccountRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>(emptyDraft);
  const [errors, setErrors] = useState<Partial<Record<keyof AccountDraft, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'info' | 'success' | 'error'>('info');
  const [editTarget, setEditTarget] = useState<AccountRecord | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try { setAccounts((await listAccounts()).accounts); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not load accounts.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const closeModal = useCallback(() => {
    if (saving) return;
    setModalOpen(false);
    setErrors({});
    setDraft(emptyDraft);
    setSaveError(null);
    setEditTarget(null);
  }, [saving]);

  const openModal = (account?: AccountRecord) => {
    setEditTarget(account ?? null);
    setDraft(emptyDraft);
    setErrors({});
    setSaveError(null);
    setModalOpen(true);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const nextErrors: typeof errors = {};
    if (!draft.cookieData.trim()) nextErrors.cookieData = 'Paste a Cookie header or JSON cookie export.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      const { account } = await (editTarget ? updateAccountCookies(editTarget.id, draft) : addAccount(draft));
      setAccounts((current) => [account, ...current.filter((item) => item.id !== account.id)]);
      setModalOpen(false);
      setDraft(emptyDraft);
      setEditTarget(null);
      setNoticeTone('success');
      setNotice(`Connected to Skool as ${account.displayName}. Your session has been verified.`);
      void reload();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save account.');
    } finally { setSaving(false); }
  };

  const handleVerify = async (account: AccountRecord) => {
    if (verifyingId) return;
    setVerifyingId(account.id);
    try {
      const result = await verifyAccount(account.id);
      setAccounts((current) => current.map((item) => item.id === account.id ? result.account : item));
      setNoticeTone('success');
      setNotice(`Session verified for ${result.account.displayName}.`);
    } catch (error) {
      setNoticeTone('error');
      setNotice(error instanceof Error ? error.message : 'Could not verify this session.');
      await reload();
    } finally { setVerifyingId(null); }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await removeAccount(deleteTarget.id);
      setAccounts((current) => current.filter((account) => account.id !== deleteTarget.id));
      setDeleteTarget(null);
      setNoticeTone('success');
      setNotice('Account and stored cookies removed.');
    } catch (error) {
      setDeleteTarget(null);
      setNoticeTone('error');
      setNotice(error instanceof Error ? error.message : 'Could not remove account.');
    } finally { setDeleting(false); }
  };

  const columns: DataColumn<AccountRecord>[] = [
    {
      key: 'account',
      header: 'Account',
      render: (account) => (
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
              toneClasses[account.avatarTone],
            )}
          >
            {account.displayName.charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{account.displayName}</p>
            <p className="truncate text-xs text-ink-muted">{account.identifier || 'Imported with cookies'}</p>
            {account.verificationError && <p className="mt-1 max-w-sm text-xs text-primary">{account.verificationError}</p>}
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (account) => verifyingId === account.id ? <span className="text-xs text-ink-muted">Checking…</span> : <StatusBadge status={account.status} /> },
    { key: 'cookies', header: 'Cookies', render: (account) => `${account.cookieCount ?? 0} stored` },
    { key: 'verifiedAt', header: 'Last verified', render: (account) => account.verifiedAt ? new Date(account.verifiedAt).toLocaleString() : 'Never' },
    {
      key: 'actions',
      header: 'Actions',
      className: 'w-12 text-right',
      render: (account) => (
        <div className="flex justify-end">
          <Dropdown
            label={`Actions for ${account.displayName}`}
            trigger={({ toggle, open }) => (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label={`Actions for ${account.displayName}`}
                className="rounded-lg p-1.5 text-ink-muted transition-colors hover:bg-elevated hover:text-ink"
              >
                <EllipsisVertical size={18} />
              </button>
            )}
          >
            {(close) => (
              <>
                <DropdownItem icon={<RefreshCw size={14} />} onSelect={() => { close(); openModal(account); }}>Update Cookies</DropdownItem>
                <DropdownItem icon={<ShieldCheck size={14} />} onSelect={() => { close(); void handleVerify(account); }}>Verify Session</DropdownItem>
                <DropdownItem
                  tone="danger"
                  icon={<Trash2 size={14} />}
                  onSelect={() => {
                    close();
                    setDeleteTarget(account);
                  }}
                >
                  Remove account
                </DropdownItem>
              </>
            )}
          </Dropdown>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Skool Accounts"
        subtitle="Manage your account records and connection status."
        actions={<Button icon={<Plus size={16} />} onClick={() => openModal()}>Add Account</Button>}
      />

      {notice && <Notice message={notice} tone={noticeTone} onDismiss={() => setNotice(null)} />}

      {loadError ? (
        <div role="alert" className="space-y-3 rounded-card border border-line bg-card p-4">
          <p className="text-sm text-ink-secondary">{loadError}</p>
          <p className="text-xs text-ink-muted">You can open Add Account now. Saving requires the database connection.</p>
          <Button variant="secondary" onClick={() => void reload()}>Retry Connection</Button>
        </div>
      ) : loading ? <p role="status" className="text-sm text-ink-secondary">Loading accounts…</p> : <DataTable
        columns={columns}
        rows={accounts}
        getRowKey={(account) => account.id}
        emptyMessage="No account records yet."
      />}

      <p className="text-xs text-ink-muted">
        Cookies are encrypted in MongoDB. Connected accounts were verified with Skool at the time shown. Use Update Cookies when a session expires.
      </p>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editTarget ? 'Update Cookies' : 'Add Account'}
        description="Paste cookies from your signed-in Skool session. We verify them and load your profile name."
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="add-account-form" disabled={saving}>
              {saving ? 'Verifying…' : editTarget ? 'Update & Verify' : 'Connect Account'}
            </Button>
          </>
        }
      >
        <form id="add-account-form" onSubmit={handleSave} className="space-y-4" noValidate>
          {saveError && <p role="alert" className="text-sm text-primary">{saveError}</p>}
          <fieldset disabled={saving} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="account-cookies" className="text-[13px] font-medium text-ink-secondary">Cookie data</label>
            <textarea
              id="account-cookies"
              rows={6}
              value={draft.cookieData}
              onChange={(event) => setDraft({ ...draft, cookieData: event.target.value })}
              placeholder={'session=…; other=… or [{"name":"…","value":"…","domain":".skool.com"}]'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={131072}
              aria-invalid={Boolean(errors.cookieData)}
              aria-describedby="cookie-help cookie-error"
              className="w-full resize-y rounded-lg border border-line bg-app px-3 py-2 font-mono text-xs text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p id="cookie-help" className="text-xs text-ink-muted">Include auth_token and client_id. Export all Skool cookies, including HttpOnly cookies, while signed in. A Cookie header or JSON export is supported.</p>
            <p id="cookie-error" className="text-xs text-primary">{errors.cookieData}</p>
          </div>
          </fieldset>
        </form>
      </Modal>
      <Modal open={Boolean(deleteTarget)} onClose={() => { if (!deleting) setDeleteTarget(null); }} title="Remove account"
        description={`Remove ${deleteTarget?.displayName ?? 'this account'} and its stored cookies?`}
        footer={<><Button variant="secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button disabled={deleting} onClick={() => void handleDelete()}>{deleting ? 'Removing…' : 'Remove Account'}</Button></>}>
        <p className="text-sm text-ink-secondary">You will need to import cookies again to add this account later.</p>
      </Modal>
    </div>
  );
}

