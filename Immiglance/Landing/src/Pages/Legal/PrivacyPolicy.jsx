import LegalDocument from "./LegalDocument";

const CONTACT = "Use the contact form in the Contact section of our home page (immiglance.com), or write to us through the messaging area of your client portal, and mark your message \"Privacy\".";

const SECTIONS = [
  {
    id: "information-we-collect",
    title: "Information we collect",
    paragraphs: ["We collect only what we need to evaluate your eligibility, prepare your case and keep your account secure. Depending on how you use Immiglance, this can include:"],
    items: [
      "Identity and contact details: name, e-mail address, phone number, mailing address, date and place of birth.",
      "Immigration and case information: visa category, answers to the eligibility quiz and intake questionnaires, family and employment details, and the data you or your team enter into the forms we prepare for you.",
      "Documents you upload: passports, identity documents, certificates, employment and financial records, and similar supporting files.",
      "Account details: your login e-mail, an encrypted password (or sign-in through a provider you choose), and your notification preferences.",
      "Payment-related information: invoice and payment status. Card details are handled by our payment processor and are not stored by us.",
      "Technical information: IP address, browser and device type, pages visited and time spent, collected through logs and cookies.",
    ],
  },
  {
    id: "how-we-collect",
    title: "How we collect information",
    items: [
      "Directly from you, when you take the eligibility quiz, book a consultation, create an account, complete a questionnaire, upload a document or send us a message.",
      "From people you authorise, such as a family member, employer or representative who is invited to your case.",
      "Automatically, through cookies, server logs and similar technology when you visit our website or use the portal.",
    ],
  },
  {
    id: "how-we-use",
    title: "How we use your information",
    items: [
      "To assess eligibility, create and manage your case, and pre-fill the forms and documents your case needs.",
      "To let you, our case team and any attorney assigned to your matter communicate and work on the case.",
      "To send service messages: appointment reminders, document requests, status updates and security notices.",
      "To operate, secure, troubleshoot and improve the platform, and to prevent fraud and misuse.",
      "To meet legal and regulatory obligations and to enforce our Terms & Conditions.",
    ],
    paragraphs: ["We do not sell your personal information."],
  },
  {
    id: "text-messages",
    title: "Text messages (SMS)",
    paragraphs: [
      "If you give us your mobile number and agree to receive texts, we may send you appointment reminders, document requests and case updates. Message frequency varies with your case, and message and data rates may apply.",
      "You can stop texts at any time by replying STOP, and ask for help by replying HELP. Opting out of texts does not affect your case. We do not share mobile numbers or SMS consent with third parties for their own marketing.",
    ],
  },
  {
    id: "email",
    title: "E-mail",
    paragraphs: [
      "We send service e-mails about your account and case (for example invitations, document requests, status changes and security alerts). These are needed to deliver the service. Where we send optional updates or marketing, each message includes a way to unsubscribe.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies and similar technology",
    paragraphs: [
      "Cookies are small files stored on your device. We use them to keep you signed in, remember your preferences such as light or dark theme, protect against fraud, and understand how the site is used so we can improve it.",
      "Most browsers let you refuse or delete cookies. If you block essential cookies, parts of the portal such as signing in may stop working.",
    ],
  },
  {
    id: "sharing",
    title: "How we share information",
    paragraphs: ["We share personal information only as needed to provide the service:"],
    items: [
      "With the attorney or law firm that supervises and represents you, and with the Immiglance team members working on your case.",
      "With service providers that run the platform for us (hosting and storage, e-mail and SMS delivery, scheduling, payments, analytics), under confidentiality and security obligations and only for our purposes.",
      "With government agencies and other parties when you direct us to file or submit something on your behalf, or when the law requires it.",
      "In connection with a merger, acquisition or sale of assets, in which case we will keep your information protected under terms no less strict than these.",
      "To protect rights, safety and security, or to respond to a valid legal request.",
    ],
  },
  {
    id: "international-transfers",
    title: "International transfers",
    paragraphs: [
      "Immigration matters often involve people and authorities in several countries. Your information may be processed and stored in the United States or other countries where we or our providers operate, which may have data-protection rules different from those where you live. When we transfer information we use appropriate safeguards and require our providers to protect it.",
    ],
  },
  {
    id: "retention",
    title: "How long we keep information",
    paragraphs: [
      "We keep information for as long as your account is active or as needed to provide the service, and afterwards for the period required to meet legal, accounting and record-keeping duties, resolve disputes and enforce our agreements. When it is no longer needed we delete it or make it anonymous. Items removed from your account may stay in a recycle area for a limited period before permanent deletion.",
    ],
  },
  {
    id: "security",
    title: "Security",
    paragraphs: [
      "We use administrative, technical and physical safeguards that fit the sensitivity of immigration data, including encrypted connections, access controls limited to people who need the information, role-based permissions and activity logs. No system is completely secure, so we cannot guarantee absolute security. Please keep your password private and tell us right away if you suspect unauthorised access to your account.",
    ],
  },
  {
    id: "your-rights",
    title: "Your privacy rights",
    paragraphs: [
      "Depending on where you live, you may have the right to know what personal information we hold about you, to receive a copy of it, to correct it, to delete it, to object to or limit some uses, and to withdraw consent you gave earlier. We will not treat you unfavourably for exercising these rights.",
      "California residents: you may request details of the categories of personal information we collected, the sources, the purposes and the categories of recipients, and you may ask us to delete or correct your information. We do not sell or share personal information for cross-context behavioural advertising.",
      "To make a request, contact us as described below. We may need to verify your identity first, and we may keep information we are legally required to retain.",
    ],
  },
  {
    id: "children",
    title: "Children's privacy",
    paragraphs: [
      "Immiglance is meant for adults. We do not knowingly collect personal information directly from children under 13. A parent or guardian may provide information about a child where the child is a family member on an immigration case. If you believe a child has given us information on their own, contact us and we will delete it.",
    ],
  },
  {
    id: "third-party-links",
    title: "Third-party links",
    paragraphs: [
      "Our site and portal may link to other websites, such as government agency pages. We do not control those sites and are not responsible for their content or privacy practices. Please read their policies before giving them information.",
    ],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    paragraphs: [
      "We may update this policy from time to time. The effective date at the top shows when it last changed. If a change is significant we will notify you through the site or by e-mail. Continuing to use Immiglance after a change means you accept the updated policy.",
    ],
  },
  {
    id: "contact",
    title: "Contact us",
    paragraphs: ["If you have questions about this policy or want to use your privacy rights: " + CONTACT],
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effective="October 24, 2026"
      intro={[
        "This Privacy Policy explains what personal information Immiglance collects, why we collect it, how we use and protect it, and the choices you have. By using our website, eligibility quiz or client portal you agree to the practices described here.",
        "Immiglance is not a law firm and does not provide legal advice. Where legal services are provided, they are provided exclusively by an independent, attorney-supervised law firm.",
      ]}
      sections={SECTIONS}
      other={{ to: "/terms-and-conditions", label: "Terms & Conditions" }}
    />
  );
}
