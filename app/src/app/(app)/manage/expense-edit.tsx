import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { pickFile } from '@/components/file-pick';
import { Ledger, SideCard, Split } from '@/components/money/blocks';
import { parseAmount } from '@/components/tax';
import { Actions, Button, ChipField, ErrorNote, Field, FieldsCard, Loading, Notice, PageHeader, Screen, Toggle, Txt, useToast } from '@/components/ui';
import { source } from '@/data';
import { useAction, useExpenses, useSettings } from '@/data/hooks';
import { formatAED } from '@/domain/billing';
import { addDays, formatDate, toDateKey } from '@/domain/dates';
import { round2 } from '@/domain/money';
import type { Expense } from '@/domain/types';
import { confirm } from '@/lib/confirm';
import { pct } from '@/lib/invoice-pdf';

const CATEGORIES = ['Rent', 'Software', 'Marketing', 'Resources', 'Travel', 'Insurance', 'Bank & card fees', 'Other'];

const head = <Stack.Screen options={{ headerShown: false }} />;

/** The VAT inside an amount that includes VAT at `rate`, e.g. 21 of 441 at 5%. */
const vatWithin = (amount: number, rate: number) => round2((amount * rate) / (1 + rate));

export default function ExpenseEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const expenses = useExpenses();
  const settings = useSettings();
  if ((id && expenses.isLoading) || settings.isLoading) {
    return (
      <Screen topInset>
        {head}
        <Loading />
      </Screen>
    );
  }
  return <ExpenseForm existing={id ? expenses.data?.find((e) => e.id === id) : undefined} vatRate={settings.data?.vatRate ?? 0} />;
}

function ExpenseForm({ existing, vatRate }: { existing?: Expense; vatRate: number }) {
  const toast = useToast();
  const save = useAction(source.saveExpense);
  const del = useAction(source.deleteExpense);
  const [date, setDate] = useState(existing?.date ?? toDateKey(new Date()));
  const [category, setCategory] = useState(existing?.category ?? '');
  const [otherName, setOtherName] = useState(existing && !CATEGORIES.includes(existing.category) ? existing.category : '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [vat, setVat] = useState(existing?.vatAmount ? String(existing.vatAmount) : '');
  // A convenience: fill in the VAT from the amount at the Settings rate. The VAT stays an explicit amount.
  const [includesVat, setIncludesVat] = useState(
    () => !!existing && vatRate > 0 && existing.vatAmount > 0 && existing.vatAmount === vatWithin(existing.amount, vatRate),
  );
  const [receiptPath, setReceiptPath] = useState(existing?.receiptPath);
  const [uploading, setUploading] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const isOther = category === 'Other' || (!!category && !CATEGORIES.includes(category));
  const categoryName = isOther ? otherName.trim() : category;
  const total = parseAmount(amount);
  const vatValue = vat.trim() ? parseAmount(vat) : 0;
  const amountError = Number.isNaN(total) || total <= 0 ? 'Enter the amount paid.' : null;
  const vatError =
    Number.isNaN(vatValue) || vatValue < 0
      ? 'Enter the VAT as an amount, or leave it blank.'
      : !amountError && vatValue > total
        ? 'The VAT cannot be more than the amount paid.'
        : null;
  const dateError = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(date).getTime()) ? null : 'Enter the date as YYYY-MM-DD.';
  const valid = !!categoryName && !amountError && !vatError && !dateError;
  const net = !amountError ? round2(total - (vatError ? 0 : vatValue)) : 0;
  const today = toDateKey(new Date());
  const yesterday = toDateKey(addDays(new Date(), -1));

  function changeAmount(v: string) {
    setAmount(v);
    if (includesVat) {
      const n = parseAmount(v);
      setVat(Number.isNaN(n) ? '' : vatWithin(n, vatRate).toFixed(2));
    }
  }

  function toggleIncludesVat(on: boolean) {
    setIncludesVat(on);
    if (on && !Number.isNaN(total)) setVat(vatWithin(total, vatRate).toFixed(2));
  }

  async function attach() {
    setError(null);
    const file = await pickFile(['image/*', 'application/pdf']);
    if (!file) return;
    setUploading(true);
    try {
      setReceiptPath(source.uploadFile ? await source.uploadFile('receipts', date.slice(0, 7), file) : file.name);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
    }
  }

  async function viewReceipt() {
    const url = receiptPath && (await source.fileUrl?.('receipts', receiptPath));
    if (url) Linking.openURL(url);
  }

  async function submit() {
    setTried(true);
    if (!valid) return;
    await save.mutateAsync([
      { id: existing?.id, date, category: categoryName, description: description.trim() || undefined, amount: total, vatAmount: vatValue, receiptPath },
    ]);
    router.back();
    toast(existing ? 'Expense saved.' : `Expense added: ${formatAED(total)} in ${categoryName}.`);
  }

  return (
    <Screen topInset>
      {head}
      <PageHeader
        back
        kicker="Money · Expense"
        title={existing ? 'Edit expense' : 'Add an expense'}
        sub="Recorded in the profit and loss. Reclaimable VAT goes into the quarter’s VAT return."
      />
      {tried && !valid ? (
        <Notice tone="danger" title="Not saved yet">
          A few details are missing. They are marked below.
        </Notice>
      ) : null}
      <Split weights={[3, 2]}>
        <View style={{ gap: 20 }}>
          <FieldsCard>
            <Field label="What it was for" value={description} onChangeText={setDescription} placeholder="e.g. Zoom annual licence" hint="Optional." />
            <ChipField label="Category" options={CATEGORIES} value={isOther ? 'Other' : category} onChange={setCategory} error={tried && !category} />
            {isOther ? (
              <Field label="Category name" value={otherName} onChangeText={setOtherName} placeholder="e.g. Accountant" error={tried && !otherName.trim()} />
            ) : null}
            <Field
              label="Amount paid (AED)"
              value={amount}
              onChangeText={changeAmount}
              keyboardType="decimal-pad"
              placeholder="e.g. 420"
              hint="Including any VAT."
              error={tried ? (amountError ?? undefined) : undefined}
            />
            {vatRate > 0 ? (
              <Toggle
                title={`Includes ${pct(vatRate)} VAT`}
                note="Fills in the VAT below from the amount paid. It can only be reclaimed with a tax invoice from the supplier."
                value={includesVat}
                onValueChange={toggleIncludesVat}
              />
            ) : null}
            <Field
              label="VAT included (AED)"
              value={vat}
              onChangeText={(v) => {
                setVat(v);
                setIncludesVat(false);
              }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              hint="The VAT shown on the supplier’s tax invoice. Leave blank when there is none."
              error={vatError ?? undefined}
            />
            <View style={{ gap: 10 }}>
              <Field
                label="Date"
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                hint={dateError ? undefined : formatDate(date)}
                error={tried ? (dateError ?? undefined) : undefined}
              />
              <ChipField
                options={[
                  { value: today, label: 'Today' },
                  { value: yesterday, label: 'Yesterday' },
                ]}
                value={date}
                onChange={setDate}
              />
            </View>
          </FieldsCard>

          <FieldsCard title="Receipt">
            <Txt variant="note">
              {receiptPath ? `Attached: ${receiptPath.split('/').pop()}` : 'Attach a photo or PDF of the receipt so your accountant has it.'}
            </Txt>
            <Actions>
              <Button
                title={receiptPath ? 'Replace receipt' : 'Attach receipt'}
                icon="attach_file"
                variant="secondary"
                size="sm"
                loading={uploading}
                onPress={attach}
              />
              {receiptPath && source.fileUrl ? <Button title="View receipt" icon="visibility" variant="ghost" size="sm" onPress={viewReceipt} /> : null}
            </Actions>
          </FieldsCard>
        </View>

        <View style={{ gap: 20 }}>
          <SideCard label="In the books">
            <Txt variant="groupTitle" numberOfLines={2}>
              {description.trim() || (categoryName ? categoryName : 'New expense')}
            </Txt>
            <Ledger
              lines={[
                { label: 'Net', value: formatAED(net) },
                { label: 'VAT to reclaim', value: formatAED(vatError ? 0 : vatValue) },
                { label: 'Category', value: categoryName || '—' },
                { label: 'Total paid', value: formatAED(amountError ? 0 : total), strong: true },
              ]}
            />
            {vatValue > 0 && !receiptPath ? (
              <Notice tone="warn">Attach the tax invoice before the quarter closes, or the VAT cannot be reclaimed.</Notice>
            ) : (
              <Txt variant="small">
                {dateError ? 'Shows in the profit and loss for its month.' : `Shows in the profit and loss for ${formatDate(date).replace(/^\d+ /, '')}.`}
              </Txt>
            )}
          </SideCard>
          <ErrorNote error={error ?? save.error ?? del.error} />
          <Actions>
            <Button
              title={existing ? 'Save expense' : 'Add expense'}
              disabled={uploading}
              loading={save.isPending}
              onPress={() => void submit().catch(() => undefined)}
            />
            <Button title="Cancel" variant="secondary" onPress={() => router.back()} />
          </Actions>
          {existing ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <Button
                title="Delete expense"
                icon="delete"
                variant="danger"
                size="sm"
                onPress={() =>
                  confirm(
                    'Delete expense?',
                    'This cannot be undone.',
                    async () => {
                      await del.mutateAsync([existing.id]);
                      router.back();
                      toast('Expense deleted.');
                    },
                    'Delete',
                  )
                }
              />
            </View>
          ) : null}
        </View>
      </Split>
    </Screen>
  );
}
