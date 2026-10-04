import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { pickFile } from '@/components/file-pick';
import { Button, Card, Chip, ErrorNote, Field, Loading, Row, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { source } from '@/data';
import { useAction, useExpenses } from '@/data/hooks';
import { toDateKey } from '@/domain/dates';
import type { Expense } from '@/domain/types';
import { confirm } from '@/lib/confirm';

const CATEGORIES = ['Rent', 'Software', 'Marketing', 'Resources', 'Travel', 'Insurance', 'Bank & card fees', 'Other'];

export default function ExpenseEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const expenses = useExpenses();
  if (id && expenses.isLoading) return <Loading />;
  return <ExpenseForm existing={id ? expenses.data?.find((e) => e.id === id) : undefined} />;
}

function ExpenseForm({ existing }: { existing?: Expense }) {
  const save = useAction(source.saveExpense);
  const del = useAction(source.deleteExpense);
  const [date, setDate] = useState(existing?.date ?? toDateKey(new Date()));
  const [category, setCategory] = useState(existing?.category ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [vat, setVat] = useState(existing ? String(existing.vatAmount) : '');
  const [receiptPath, setReceiptPath] = useState(existing?.receiptPath);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && category.trim() && Number(amount) > 0 && !(Number(vat) < 0);

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

  return (
    <Screen
      footer={
        <Button
          title={existing ? 'Save expense' : 'Add expense'}
          variant="gold"
          style={{ flex: 1 }}
          disabled={!valid || uploading}
          loading={save.isPending}
          onPress={async () => {
            await save.mutateAsync([
              { id: existing?.id, date, category: category.trim(), description: description.trim() || undefined, amount: Number(amount), vatAmount: Number(vat) || 0, receiptPath },
            ]);
            router.back();
          }}
        />
      }>
      <Stack.Screen options={{ title: existing ? 'Expense' : 'Add expense' }} />
      <Card style={{ gap: Spacing.three }}>
        <Txt variant="label">Category</Txt>
        <Row style={{ gap: Spacing.one, flexWrap: 'wrap' }}>
          {CATEGORIES.map((c) => (
            <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </Row>
        {category === 'Other' || (category && !CATEGORIES.includes(category)) ? (
          <Field label="Category name" value={category === 'Other' ? '' : category} onChangeText={setCategory} placeholder="e.g. Accountant" />
        ) : null}
        <Field label="Description (optional)" value={description} onChangeText={setDescription} />
        <Field label="Amount (AED, including VAT)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Field label="VAT included (AED)" value={vat} onChangeText={setVat} keyboardType="decimal-pad" placeholder="0" />
        <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
      </Card>
      <Card style={{ gap: Spacing.two }}>
        <Txt variant="h3">Receipt</Txt>
        {receiptPath ? <Txt variant="muted">Attached: {receiptPath.split('/').pop()}</Txt> : <Txt variant="muted">Add a photo or PDF so your accountant has it.</Txt>}
        <Row style={{ gap: Spacing.two }}>
          <Button title={receiptPath ? 'Replace' : 'Attach receipt'} icon="doc" variant="secondary" size="sm" loading={uploading} onPress={attach} />
          {receiptPath && source.fileUrl ? <Button title="View" variant="ghost" size="sm" onPress={viewReceipt} /> : null}
        </Row>
      </Card>
      <ErrorNote error={error ?? save.error ?? del.error} />
      {existing ? (
        <Button
          title="Delete expense"
          variant="danger"
          onPress={() =>
            confirm('Delete expense?', 'This can’t be undone.', async () => {
              await del.mutateAsync([existing.id]);
              router.back();
            }, 'Delete')
          }
        />
      ) : null}
    </Screen>
  );
}
