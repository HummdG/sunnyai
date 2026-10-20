import type { Metadata } from 'next';
import Link from 'next/link';

import { TermsScene } from '../../../components/scenes/pages.js';
import { PageIntro } from '../../../components/blocks.js';
import { LEGAL } from '../../site.js';

export const metadata: Metadata = {
  title: 'Terms of service',
  description: 'The terms on which solar installers use Sunny, including how we process data.',
};

const CONTENTS = [
  ['about', 'About these terms'],
  ['account', 'Your account'],
  ['plans', 'Plans, add-ons and trials'],
  ['fees', 'Fees and payment'],
  ['changes-cancel', 'Changing plan and cancelling'],
  ['your-website', 'Using Sunny with your customers'],
  ['estimates', 'Estimates and AI answers'],
  ['email', 'The email assistant'],
  ['voice', 'Voice and phone'],
  ['acceptable-use', 'Acceptable use'],
  ['content', 'Your content and ours'],
  ['data', 'Data protection and processing'],
  ['service', 'Availability and support'],
  ['suspension', 'Suspension and ending the agreement'],
  ['liability', 'Liability'],
  ['changes', 'Changes to these terms'],
  ['general', 'General'],
] as const;

export default function TermsPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Terms"
        title="Terms of service"
        lede="The agreement between you, the installer, and us when you use Sunny. It includes the terms on which we process your customers’ data for you."
        scene={<TermsScene />}
      />
      <section className="section">
        <div className="wrap prose">
          <p className="legal-meta">Last updated {LEGAL.updated}.</p>

          <h2>Contents</h2>
          <ol>
            {CONTENTS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`}>{label}</a>
              </li>
            ))}
          </ol>

          <h2 id="about">1. About these terms</h2>
          <p>
            These terms are an agreement between {LEGAL.companyName} (“{LEGAL.tradingName}”, “we”,
            “us”), company number {LEGAL.companyNumber}, registered office {LEGAL.registeredAddress}
            , and the business that creates a Sunny account (“you”). They apply from when you create
            an account.
          </p>
          <p>
            Sunny is for businesses. By accepting these terms you confirm that you are acting for a
            business and have authority to bind it. Consumer protection law that only applies to
            consumers does not apply to this agreement.
          </p>
          <p>
            In these terms, <strong>Sunny</strong> or the <strong>service</strong> means our AI
            assistant, the chat widget, the dashboard and any add-ons you subscribe to.{' '}
            <strong>Your customers</strong> means the homeowners and other people who talk to Sunny
            on your website, by email or by phone. Our <Link href="/privacy">privacy policy</Link>{' '}
            explains how we handle personal information.
          </p>

          <h2 id="account">2. Your account</h2>
          <ul>
            <li>Give us accurate details and keep them up to date.</li>
            <li>
              Keep sign-in details secure. You are responsible for what happens in your account,
              including what the team members you invite do. Give each person only the role they
              need.
            </li>
            <li>Tell us straight away if you think someone has got into your account.</li>
          </ul>

          <h2 id="plans">3. Plans, add-ons and trials</h2>
          <p>
            The plans, what they include and their prices are on our{' '}
            <Link href="/pricing">pricing page</Link>. The Base plan is needed for the add-ons. The
            Voice &amp; Phone add-on includes 500 call minutes each billing month; unused minutes do
            not carry over. When the minutes are used up, calls are passed to your team or callers
            are invited to use the website chat, until the next billing month.
          </p>
          <p>
            When we offer a free trial, we tell you its length when you sign up. At the end of a
            trial, you need a paid plan to keep using Sunny.
          </p>

          <h2 id="fees">4. Fees and payment</h2>
          <ul>
            <li>
              Fees are charged monthly in advance, in pounds sterling, by card through our payment
              provider, Stripe. Prices exclude VAT, which is added where it applies.
            </li>
            <li>There is no setup fee.</li>
            <li>
              If a payment fails, we will tell you and try again. If it is still unpaid after seven
              days, we may suspend Sunny until it is paid.
            </li>
            <li>
              We may change our prices by giving you at least 30 days’ notice. The new price applies
              from your next billing month after the notice ends. If you do not accept it, you can
              cancel before then.
            </li>
          </ul>

          <h2 id="changes-cancel">5. Changing plan and cancelling</h2>
          <ul>
            <li>
              You can move to a different plan, or add or remove an add-on, at any time from the
              Billing page of your dashboard. Changes apply from your next billing month.
            </li>
            <li>
              You can cancel at any time from the Billing page. Sunny keeps working until the end of
              the billing month you have paid for, and then stops. We do not refund part months,
              unless the law requires it.
            </li>
            <li>There is no minimum term.</li>
          </ul>

          <h2 id="your-website">6. Using Sunny with your customers</h2>
          <p>You are responsible for:</p>
          <ul>
            <li>
              Only adding Sunny to websites and phone numbers you own or are allowed to manage.
            </li>
            <li>
              Telling your customers about Sunny in your own privacy notice: that you use an AI
              assistant provided by us, what it collects and why.
            </li>
            <li>
              The information you give Sunny to work from: your website, documents, products, prices
              and settings. Keep them accurate and up to date, and check anything Sunny reads for
              you (for example a product found on your website) before approving it.
            </li>
            <li>
              Following the law and the rules of your industry in what you offer and how you follow
              up, including consumer protection law, the rules on marketing calls, texts and emails,
              and any scheme you belong to, such as MCS.
            </li>
            <li>
              Following up your customers’ enquiries yourself. Sunny passes an enquiry to you only
              when the customer agrees; it does not sell or contract on your behalf.
            </li>
          </ul>

          <h2 id="estimates">7. Estimates and AI answers</h2>
          <p>
            Sunny uses artificial intelligence. It answers from the information you give it, and
            tells your customers that it is an AI assistant. AI can make mistakes, so:
          </p>
          <ul>
            <li>
              The prices, savings, payback periods and roof measurements Sunny gives are indicative
              estimates, not offers. They are labelled as subject to a survey. You confirm final
              prices, savings and whether a system is suitable, after a survey.
            </li>
            <li>
              Roof measurements come from public map, imagery and height data, which can be out of
              date or wrong.
            </li>
            <li>
              Sunny is not a substitute for professional advice, and we do not guarantee that any
              answer is complete or correct. You are responsible for the quotes and contracts you
              give your customers.
            </li>
          </ul>

          <h2 id="email">8. The email assistant</h2>
          <p>
            If you connect a mailbox, you allow Sunny to read incoming enquiries and to draft
            replies. Replies are drafts for you to approve, unless you turn on automatic sending, in
            which case you are responsible for the replies Sunny sends in your name. Replies say
            they were prepared with the help of an AI assistant. To prevent abuse, Sunny limits how
            many emails it handles and sends to any one sender each day. You can disconnect your
            mailbox at any time.
          </p>

          <h2 id="voice">9. Voice and phone</h2>
          <ul>
            <li>
              At the start of each call, Sunny tells the caller that they are speaking to an AI
              assistant and that the call may be transcribed. You can change the wording, but it
              must still say both. Website visitors must agree before using the microphone.
            </li>
            <li>
              Calls are transcribed but not recorded. Each call with Sunny lasts up to five minutes,
              after which the caller can be passed to your team.
            </li>
            <li>
              Phone numbers and calls go through our telephony provider, Twilio. You must not use
              Sunny to make unsolicited marketing calls.
            </li>
          </ul>

          <h2 id="acceptable-use">10. Acceptable use</h2>
          <p>You must not, and must not let anyone else:</p>
          <ul>
            <li>use Sunny for anything unlawful, misleading or harmful;</li>
            <li>
              give Sunny content you do not have the right to use, or that infringes anyone’s
              rights;
            </li>
            <li>
              try to get into another installer’s data, break or get around Sunny’s security or
              limits, or overload the service;
            </li>
            <li>copy, resell or reverse engineer Sunny, or use it to build a competing product;</li>
            <li>
              tell people Sunny is a person, or use it to collect information it was not designed to
              collect, such as payment card or health details.
            </li>
          </ul>

          <h2 id="content">11. Your content and ours</h2>
          <p>
            <strong>Yours.</strong> Your content (your documents, products, prices, settings and
            your customers’ enquiries) stays yours. You give us permission to use it only to provide
            and support Sunny for you. We do not use it to train AI models, and we do not share it
            with other installers.
          </p>
          <p>
            <strong>Ours.</strong> Sunny, including its software, its character and its design,
            belongs to us or our licensors. We give you a non-exclusive, non-transferable right to
            use it for your business while your subscription lasts. If you send us suggestions, we
            may use them without owing you anything.
          </p>

          <h2 id="data">12. Data protection and processing</h2>
          <p>
            When your customers talk to Sunny, you are the controller of their personal data and we
            are your processor. This section is the contract between us that Article 28 of the UK
            GDPR requires. Each of us will comply with data protection law.
          </p>
          <h3>What we process</h3>
          <ul>
            <li>
              <strong>Subject and purpose:</strong> providing Sunny to you: answering your
              customers, estimating systems, passing on enquiries, and the email and voice add-ons.
            </li>
            <li>
              <strong>Duration:</strong> while this agreement lasts, and until the data is deleted
              as described below.
            </li>
            <li>
              <strong>People:</strong> your customers and potential customers, and your staff.
            </li>
            <li>
              <strong>Types of data:</strong> conversations, transcripts and emails; contact
              details; addresses and postcodes; information about the property, energy use,
              household and budget; phone numbers; and consent records. Sunny is not designed to
              collect special category data, and you must not ask it to.
            </li>
          </ul>
          <h3>What we promise</h3>
          <ul>
            <li>
              We only process the data on your documented instructions, which are these terms and
              how you set up Sunny, unless the law requires otherwise (in which case we will tell
              you, if the law allows).
            </li>
            <li>Everyone who can access the data is bound to keep it confidential.</li>
            <li>
              We keep it secure with appropriate technical and organisational measures, including
              encryption, separation between installers, access control and logging.
            </li>
            <li>
              You authorise the sub-processors listed in our{' '}
              <Link href="/privacy#providers">privacy policy</Link>. We will give you at least 30
              days’ notice of a new sub-processor, so you can object; if we cannot address your
              objection, you can end the agreement. Each sub-processor is bound by data protection
              terms like these, and we remain responsible for them.
            </li>
            <li>We only transfer data outside the UK with the safeguards UK law requires.</li>
            <li>
              We will help you respond to your customers’ requests to use their rights, and with
              security, breach notification, data protection impact assessments and consulting the
              ICO, taking into account the information we have.
            </li>
            <li>
              We will tell you without undue delay, and within 48 hours, after becoming aware of a
              personal data breach affecting your data, with the information you need to meet your
              own obligations.
            </li>
            <li>
              Conversations and enquiries are deleted automatically after two years. When this
              agreement ends, you can export your enquiries until Sunny stops; we then delete your
              data within 90 days, unless the law requires us to keep it.
            </li>
            <li>
              We will give you the information you reasonably need to show that these obligations
              are met, and allow for audits by you or an auditor you appoint, on reasonable notice
              and at most once a year, unless a regulator requires more.
            </li>
          </ul>
          <h3>What you promise</h3>
          <ul>
            <li>
              You have a lawful basis for the processing you ask us to do, and you give your
              customers the information the law requires.
            </li>
            <li>Your instructions to us comply with data protection law.</li>
          </ul>
          <p>
            For your own account details and those of your team, we are the controller, and our
            privacy policy applies.
          </p>

          <h2 id="service">13. Availability and support</h2>
          <p>
            We work to keep Sunny available and working well, but we cannot promise it will always
            be available or free of errors. We may need to pause it for maintenance, which we will
            try to do at quiet times and tell you about in advance where we can. We may improve or
            change features; we will not remove a main feature of your plan without telling you
            first. You can contact us for support at {LEGAL.contactEmail}.
          </p>

          <h2 id="suspension">14. Suspension and ending the agreement</h2>
          <ul>
            <li>
              You can end the agreement by cancelling your subscription, as set out in section 5.
            </li>
            <li>
              We can suspend Sunny, or end the agreement straight away, if you seriously or
              repeatedly break these terms, do not pay, or use Sunny in a way that puts other people
              or the service at risk. Where we reasonably can, we will warn you first and give you a
              chance to put it right.
            </li>
            <li>
              We can end the agreement for any other reason by giving you at least 60 days’ notice,
              and refunding anything you have paid for after it ends.
            </li>
            <li>
              When it ends, your right to use Sunny stops and we handle your data as set out in
              section 12. Sections that by their nature should continue, such as liability and data
              protection, continue.
            </li>
          </ul>

          <h2 id="liability">15. Liability</h2>
          <ul>
            <li>
              Nothing in these terms limits liability for death or personal injury caused by
              negligence, for fraud, or for anything else that the law does not allow to be limited.
            </li>
            <li>
              Neither of us is liable for loss of profits, revenue, business, goodwill or data, or
              for indirect or consequential loss.
            </li>
            <li>
              Otherwise, each party’s total liability under or in connection with this agreement in
              any 12 months is limited to the fees you paid in the 12 months before the event that
              gave rise to the claim.
            </li>
            <li>
              We are not responsible for what you tell your customers or agree with them, or for
              quotes, savings or measurements you rely on without confirming them.
            </li>
            <li>
              Neither of us is responsible for delays or failures caused by events outside our
              reasonable control.
            </li>
          </ul>

          <h2 id="changes">16. Changes to these terms</h2>
          <p>
            We may update these terms. We will give you at least 30 days’ notice of any change that
            is not in your favour, by email or in your dashboard. If you do not accept a change, you
            can cancel before it takes effect. Otherwise the new terms apply from that date.
          </p>

          <h2 id="general">17. General</h2>
          <ul>
            <li>
              These terms and our privacy policy are the whole agreement between us about Sunny.
            </li>
            <li>
              You may not transfer this agreement without our agreement. We may transfer it to a
              company that takes over our business, and will tell you if we do.
            </li>
            <li>
              If part of these terms cannot be enforced, the rest still applies. Not enforcing a
              term straight away does not mean giving it up.
            </li>
            <li>Nobody else has rights under these terms.</li>
            <li>
              The law of England and Wales governs these terms, and the courts of England and Wales
              decide any dispute about them.
            </li>
          </ul>
          <p>
            Questions about these terms: {LEGAL.contactEmail}, or {LEGAL.companyName},{' '}
            {LEGAL.registeredAddress}.
          </p>
        </div>
      </section>
    </main>
  );
}
