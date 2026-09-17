import { useParams } from 'react-router-dom'
import MessageThread from '../../../components/MessageThread'

// The attorney's case-scoped review dialogue with the case manager — file
// upload + Enter-to-send included (see MessageThread's own header comment).
// This is the SAME backend thread (models/Feedback.js) the top-level
// "Messages" hub lists across all cases; this tab is just the case-scoped
// entry point into it, for when the attorney is already looking at one
// specific case and wants to leave/read feedback without navigating away.
export default function FeedbackTab() {
  const { caseId } = useParams()
  return <MessageThread caseId={caseId} />
}
