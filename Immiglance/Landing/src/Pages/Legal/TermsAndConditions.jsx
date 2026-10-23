import LegalDocument from "./LegalDocument";

const SECTIONS = [
  {
    id: "acceptance",
    title: "Acceptance of these terms",
    paragraphs: [
      "By visiting our website, taking the eligibility quiz, booking a consultation, creating an account or using the client portal (together, the \"Service\"), you agree to these Terms & Conditions and to our Privacy Policy. If you do not agree, please do not use the Service.",
    ],
  },
  {
    id: "what-we-do",
    title: "What Immiglance is and is not",
    paragraphs: [
      "Immiglance is a case evaluation and client portal platform. It helps you answer eligibility questions, organise documents, pre-fill forms, track your case and communicate with the team handling it.",
      "Immiglance is not a law firm and does not provide legal advice. Where legal services are provided, they are provided exclusively by an independent, attorney-supervised law firm, under a separate engagement agreement. Information shown in the Service, including eligibility results and pre-filled forms, is general and informational; it is not a guarantee of any outcome and is not a substitute for advice from a licensed attorney.",
    ],
  },
  {
    id: "accounts",
    title: "Your account",
    items: [
      "You must be at least 18 years old and able to enter a binding agreement.",
      "Give accurate, complete and current information and keep it up to date.",
      "Keep your login details confidential. You are responsible for activity under your account; tell us promptly if you suspect misuse.",
      "You may invite others (for example a family member or employer) to a case. You are responsible for who you invite and what they may see.",
    ],
  },
  {
    id: "your-responsibilities",
    title: "Your responsibilities",
    items: [
      "Review every answer, form and document before it is signed or filed. You are responsible for the accuracy and truthfulness of the information submitted in your name.",
      "Provide documents and replies on time. Delays or missing information can delay or harm a case.",
      "Do not give false, misleading or forged information or documents.",
      "Meet your own deadlines, including government deadlines, unless a written engagement says otherwise.",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    paragraphs: ["You agree not to:"],
    items: [
      "break any law or infringe anyone's rights through the Service;",
      "upload malicious code or content you have no right to share;",
      "try to access accounts, data or systems that are not yours, or probe, scan or disrupt the Service;",
      "copy, resell, reverse engineer or scrape the Service except as the law allows;",
      "use the Service to harass others or to submit fraudulent immigration filings.",
    ],
  },
  {
    id: "no-guarantee",
    title: "No guarantee of results",
    paragraphs: [
      "Decisions on visas, petitions and applications are made solely by government authorities, whose rules, fees and processing times change. We cannot promise approval, timing or any particular result, and past results do not guarantee future ones.",
    ],
  },
  {
    id: "fees",
    title: "Fees and payments",
    paragraphs: [
      "Using the website and eligibility quiz is free unless stated otherwise. Fees for services, and government filing fees, are set out in the agreement or invoice you receive. Unless the agreement says otherwise, fees already paid for work performed are not refundable. Government fees are paid to the government and cannot be refunded by us.",
    ],
  },
  {
    id: "your-content",
    title: "Your content and licence to us",
    paragraphs: [
      "You keep ownership of the documents and information you upload. You give us and our providers permission to store, process, copy and display that content only as needed to run the Service, prepare your case and meet legal duties.",
    ],
  },
  {
    id: "intellectual-property",
    title: "Our intellectual property",
    paragraphs: [
      "The Service, including its software, design, text, graphics and the Immiglance name and logo, belongs to Immiglance or its licensors and is protected by law. We give you a limited, personal, non-transferable licence to use the Service for its intended purpose. Official government forms remain the property of their issuers.",
    ],
  },
  {
    id: "communications",
    title: "Communications",
    paragraphs: [
      "You agree that we may contact you by e-mail, text message, phone and in-portal notices about your account and case. You may opt out of texts by replying STOP and of marketing e-mails through the unsubscribe link; service messages that are necessary to deliver the Service may still be sent.",
    ],
  },
  {
    id: "third-parties",
    title: "Third-party services and links",
    paragraphs: [
      "The Service relies on and may link to services we do not control, such as government websites, payment processors and scheduling tools. We are not responsible for them, and your use of them is subject to their own terms.",
    ],
  },
  {
    id: "availability",
    title: "Availability and changes",
    paragraphs: [
      "We work to keep the Service available but do not promise uninterrupted or error-free operation. We may change, suspend or discontinue features, with notice where reasonable, for maintenance, security or legal reasons.",
    ],
  },
  {
    id: "termination",
    title: "Suspension and termination",
    paragraphs: [
      "You may stop using the Service at any time. We may suspend or end access if you break these terms, put the Service or other users at risk, or where required by law. Sections that by their nature should continue (for example ownership, disclaimers and liability limits) survive termination.",
    ],
  },
  {
    id: "disclaimers",
    title: "Disclaimers",
    paragraphs: [
      "The Service is provided \"as is\" and \"as available\". To the fullest extent the law allows, we disclaim all warranties, express or implied, including fitness for a particular purpose, accuracy and non-infringement.",
    ],
  },
  {
    id: "liability",
    title: "Limitation of liability",
    paragraphs: [
      "To the fullest extent the law allows, Immiglance and its owners, staff and providers are not liable for indirect, incidental, special, consequential or punitive damages, or for loss of data, profits or immigration benefits, arising from your use of the Service. Our total liability for any claim is limited to the amount you paid us for the Service in the twelve months before the claim, or one hundred US dollars if you paid nothing. Some places do not allow these limits, so they may apply to you only in part.",
    ],
  },
  {
    id: "indemnity",
    title: "Indemnity",
    paragraphs: [
      "You agree to defend and hold Immiglance harmless from claims, losses and costs arising from content you submit, your breach of these terms or your violation of any law or third-party right.",
    ],
  },
  {
    id: "governing-law",
    title: "Governing law and disputes",
    paragraphs: [
      "These terms are governed by the laws of the United States and the state in which Immiglance is established, without regard to conflict-of-law rules. Disputes will be brought in the courts of that state unless a separate written agreement says otherwise. If any part of these terms is unenforceable, the rest stays in effect.",
    ],
  },
  {
    id: "changes",
    title: "Changes to these terms",
    paragraphs: [
      "We may update these terms from time to time. The effective date above shows the latest version. If a change is significant we will tell you through the Service or by e-mail. Continuing to use the Service after a change means you accept the updated terms.",
    ],
  },
  {
    id: "contact",
    title: "Contact us",
    paragraphs: [
      "Questions about these terms? Use the contact form in the Contact section of our home page (immiglance.com), or write to us through the messaging area of your client portal.",
    ],
  },
];

export default function TermsAndConditions() {
  return (
    <LegalDocument
      title="Terms & Conditions"
      effective="October 24, 2026"
      intro={[
        "These Terms & Conditions govern your use of the Immiglance website, eligibility quiz and client portal. Please read them carefully.",
        "Immiglance is not a law firm and does not provide legal advice. Where legal services are provided, they are provided exclusively by an independent, attorney-supervised law firm.",
      ]}
      sections={SECTIONS}
      other={{ to: "/privacy-policy", label: "Privacy Policy" }}
    />
  );
}
