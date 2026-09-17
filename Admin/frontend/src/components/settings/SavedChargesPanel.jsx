import SimpleCrudPanel from './SimpleCrudPanel'

export default function SavedChargesPanel() {
  return (
    <SimpleCrudPanel
      title="Saved Charges"
      endpoint="/saved-charges"
      fields={[
        { name: 'name', label: 'Charge name', required: true },
        { name: 'amount', label: 'Amount', type: 'number', required: true },
        { name: 'description', label: 'Description' },
      ]}
      columns={['Name', 'Amount', 'Description']}
      renderRow={(c) => (
        <>
          <td className="py-2 text-foreground">{c.name}</td>
          <td className="text-muted-foreground">${Number(c.amount).toFixed(2)}</td>
          <td className="text-muted-foreground">{c.description || '—'}</td>
        </>
      )}
    />
  )
}
