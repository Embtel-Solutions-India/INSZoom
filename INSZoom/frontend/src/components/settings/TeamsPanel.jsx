import SimpleCrudPanel from './SimpleCrudPanel'

export default function TeamsPanel() {
  return (
    <SimpleCrudPanel
      title="Teams"
      endpoint="/teams"
      fields={[{ name: 'name', label: 'Team name', required: true }]}
      columns={['Name', 'Members']}
      renderRow={(team) => (
        <>
          <td className="py-2 text-foreground">{team.name}</td>
          <td className="text-muted-foreground">{(team.members || []).length}</td>
        </>
      )}
    />
  )
}
