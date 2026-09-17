import SimpleCrudPanel from './SimpleCrudPanel'

export default function BranchesPanel() {
  return (
    <SimpleCrudPanel
      title="Branches"
      endpoint="/branches"
      fields={[
        { name: 'name', label: 'Branch name', required: true },
        { name: 'address', label: 'Address' },
        { name: 'phone', label: 'Phone' },
      ]}
      columns={['Name', 'Address', 'Phone']}
      renderRow={(b) => (
        <>
          <td className="py-2 text-foreground">{b.name}</td>
          <td className="text-muted-foreground">{b.address || '—'}</td>
          <td className="text-muted-foreground">{b.phone || '—'}</td>
        </>
      )}
    />
  )
}
