import type { Metadata } from 'next';

import { PrivacyScene } from '../../../components/scenes/pages.js';
import { PageIntro } from '../../../components/blocks.js';
import { LegalTable } from '../../../components/legal-table.js';
import { LEGAL } from '../../site.js';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'How Sunny handles the personal information of website visitors, callers and installers.',
};

const CONTENTS = [
  ['who-we-are', 'Who we are'],
  ['two-roles', 'Two kinds of people, two roles'],
  ['visitors', 'If you talk to Sunny on an installer’s website or phone line'],
  ['installers', 'If you are an installer using Sunny'],
  ['our-website', 'If you visit our website'],
  ['lawful-bases', 'Our lawful bases'],
  ['providers', 'Who we share information with'],
  ['transfers', 'Information outside the UK'],
  ['retention', 'How long we keep information'],
  ['ai', 'AI and automated decisions'],
  ['security', 'How we protect information'],
  ['rights', 'Your rights'],
  ['children', 'Children'],
  ['changes', 'Changes to this policy'],
  ['contact', 'Contact us'],
] as const;

export default function PrivacyPage(): React.JSX.Element {
  return (
    <main id="main">
      <PageIntro
        eyebrow="Privacy"
        title="Privacy policy"
        lede="How Sunny handles personal information: what we collect, why, who sees it, how long we keep it, and the rights you have."
        scene={<PrivacyScene />}
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

          <h2 id="who-we-are">1. Who we are</h2>
          <p>
            Sunny is an AI assistant for solar installers, provided by {LEGAL.companyName} (“
            {LEGAL.tradingName}”, “we”, “us”), a company registered in England and Wales with number{' '}
            {LEGAL.companyNumber}, whose registered office is at {LEGAL.registeredAddress}. We are
            registered with the Information Commissioner’s Office under number {LEGAL.icoNumber}.
          </p>
          <p>
            This policy explains how we handle personal information under the UK General Data
            Protection Regulation (UK GDPR) and the Data Protection Act 2018. You can reach us about
            anything in it at {LEGAL.contactEmail}.
          </p>

          <h2 id="two-roles">2. Two kinds of people, two roles</h2>
          <p>Sunny handles information about two groups of people, and our role differs:</p>
          <ul>
            <li>
              <strong>Homeowners and other visitors</strong> who chat with Sunny on a solar
              installer’s website, email the installer, or call the installer’s phone line. Here the
              installer decides why and how your information is used, so the installer is the{' '}
              <strong>controller</strong>. We are the installer’s <strong>processor</strong>: we
              handle your information on their behalf and only on their instructions, under a
              written contract (our terms of service).
            </li>
            <li>
              <strong>Installers and their staff</strong> who use Sunny, and people who visit this
              website. Here we are the <strong>controller</strong> of your information.
            </li>
          </ul>
          <p>
            If you talked to Sunny on an installer’s website or phone line, the installer’s own
            privacy notice applies too, and the installer is the first place to go with questions or
            requests about your information. We will help them answer.
          </p>

          <h2 id="visitors">3. If you talk to Sunny on an installer’s website or phone line</h2>
          <h3>What we collect</h3>
          <ul>
            <li>
              <strong>The conversation.</strong> What you write or say to Sunny and what Sunny
              replies, with the time of each message and whether it was chat, email or a call.
            </li>
            <li>
              <strong>Your answers about your home and energy use</strong>, if you ask for an
              estimate: for example your address and postcode, the type of property, whether you own
              it, your roof, your electricity use or bills, your household size, your budget and
              whether you are interested in finance. Sunny never asks you to upload a bill.
            </li>
            <li>
              <strong>A measurement of your roof</strong>, if you give your address and ask for an
              estimate. We use your address with public map, aerial imagery and height data to build
              an approximate 3D model of the building and estimate how many panels might fit.
            </li>
            <li>
              <strong>Your contact details</strong> (name, email address, phone number and
              postcode), but only if you choose to share them and agree to them being passed to the
              installer. We record that agreement: the wording you agreed to, when, and on which
              website.
            </li>
            <li>
              <strong>Your email address</strong>, if you ask Sunny to email you your quote, which
              you confirm by ticking a box first.
            </li>
            <li>
              <strong>Voice.</strong> If you speak to Sunny using the microphone on a website, only
              after you agree, your speech is sent to our AI provider so Sunny can reply, and a
              written transcript is kept. If you phone an installer whose line Sunny answers, you
              are told at the start of the call that you are speaking to an AI assistant and that
              the call may be transcribed. We keep a transcript and your phone number. We do not
              keep a recording of the audio.
            </li>
            <li>
              <strong>Email.</strong> If you email an installer who uses Sunny’s email assistant,
              Sunny reads your email to prepare a reply, and keeps your email and the reply.
            </li>
            <li>
              <strong>Technical information.</strong> Your IP address is used briefly to stop abuse
              (by limiting how many requests one address can make) and may appear in our server
              logs. The chat checks which website it is running on, so it only works on the
              installer’s own sites.
            </li>
          </ul>
          <h3>What we use it for</h3>
          <ul>
            <li>To answer your questions and keep the conversation going.</li>
            <li>To work out indicative options, prices and savings for your home.</li>
            <li>
              To pass your enquiry to the installer, when you agree, so they can contact you. The
              installer can see the conversation, your answers, any estimate and your contact
              details in their Sunny dashboard, and can export their enquiries.
            </li>
            <li>To keep Sunny secure and working, and to fix problems.</li>
          </ul>
          <p>
            We do not sell your information, use it for advertising, or use one installer’s
            information for another installer. Sunny does not read the cookies, passwords or other
            data of the website it sits on.
          </p>
          <h3>Nothing stored in your browser</h3>
          <p>
            The Sunny chat on an installer’s website sets no cookies and stores nothing in your
            browser. It holds a temporary session in memory that expires after two hours or when you
            leave the page. If the installer turns on spam protection, the chat loads Cloudflare
            Turnstile, which may set its own storage to tell people from bots.
          </p>

          <h2 id="installers">4. If you are an installer using Sunny</h2>
          <h3>What we collect</h3>
          <ul>
            <li>
              <strong>Account details:</strong> your email address and password (handled by Google
              Firebase Authentication, so we never see your password), or your Google sign-in.
            </li>
            <li>
              <strong>Company details:</strong> company name, website, the settings you choose for
              Sunny, and the contact details you want Sunny to give visitors.
            </li>
            <li>
              <strong>Your team:</strong> the email addresses and roles of the people you invite,
              and who invited them.
            </li>
            <li>
              <strong>Billing:</strong> your subscription and its status. Card payments are taken by
              Stripe; we never see or store your card details.
            </li>
            <li>
              <strong>Your content:</strong> your website pages, documents, product and price lists
              that you give Sunny to learn from. Documents are checked for personal information and
              personal details are removed or held back before Sunny uses them.
            </li>
            <li>
              <strong>Connected accounts</strong>, only if you connect them: read-only access to a
              Google Drive folder you choose, and for the email assistant, access to your Gmail or
              Outlook mailbox so Sunny can read incoming enquiries and draft or send replies. The
              access keys are stored encrypted, and you can disconnect at any time.
            </li>
            <li>
              <strong>Activity records:</strong> a log of important actions in your account (for
              example who changed a setting or exported enquiries) to keep it secure.
            </li>
          </ul>
          <h3>What we use it for</h3>
          <p>
            To provide Sunny to you, bill you, support you, keep your account secure, tell you about
            changes to the service, and meet our legal obligations. We do not send marketing emails
            without your agreement.
          </p>

          <h2 id="our-website">5. If you visit our website</h2>
          <p>
            This website uses no analytics, advertising or tracking cookies, and no third-party
            trackers. It only stores what signing in to the dashboard needs:
          </p>
          <LegalTable
            label="What this website stores"
            head={['Name', 'Type', 'Purpose', 'How long']}
            rows={[
              [
                'sunny_session',
                'Cookie',
                'Keeps you signed in to the dashboard',
                'Until your session ends (up to 7 days)',
              ],
              [
                'sunny_signed_in',
                'Cookie',
                'Tells the website you are signed in, without holding your session',
                'Same as above',
              ],
              [
                'sunny.signin.email',
                'Local storage',
                'Remembers your email address while you sign in with an email link',
                'Removed once you are signed in',
              ],
              [
                'sunny.portal.tenant',
                'Local storage',
                'Remembers which company you last chose, if you belong to more than one',
                'Until you clear it',
              ],
              [
                'Firebase Authentication',
                'Browser storage (IndexedDB)',
                'Keeps your sign-in with Google Firebase',
                'Until you sign out',
              ],
            ]}
          />
          <p>
            These are strictly necessary for a service you ask for, so they do not need consent.
          </p>
          <h3 id="waitlist">If you join our waitlist</h3>
          <p>
            We keep your email address, your company name if you give it, when you joined, the
            wording you agreed to and the website you joined from. We use them only to email you
            when Sunny is ready for your business, with your consent, which you can withdraw at any
            time by emailing {LEGAL.contactEmail}. We do not share the list with anyone. Your IP
            address is used briefly to stop abuse of the form, and is not kept with your entry.
          </p>

          <h2 id="lawful-bases">6. Our lawful bases</h2>
          <p>Where we are the controller, we rely on:</p>
          <ul>
            <li>
              <strong>Contract:</strong> to provide Sunny to installers and bill them.
            </li>
            <li>
              <strong>Legitimate interests:</strong> to keep Sunny secure, prevent abuse, fix
              problems and improve the service, in ways people would expect and that do not override
              their rights.
            </li>
            <li>
              <strong>Legal obligation:</strong> to keep financial records and respond to lawful
              requests.
            </li>
            <li>
              <strong>Consent:</strong> where we ask for it, which you can withdraw at any time.
            </li>
          </ul>
          <p>
            Where we act for an installer, the installer chooses the lawful basis for using your
            information. Your contact details are only passed to the installer with your consent.
          </p>

          <h2 id="providers">7. Who we share information with</h2>
          <p>
            We use the service providers below to run Sunny. Each only gets what it needs, and is
            bound by a contract to protect it. We share information with the installer you talked
            to, as described above, and we may share it if the law requires it, or with a buyer if
            our business is sold (who would have to protect it in the same way).
          </p>
          <LegalTable
            label="Service providers"
            head={['Provider', 'What for', 'What it receives']}
            rows={[
              [
                'Google Cloud (Google Ireland and Google LLC)',
                'Hosting and our database, in London',
                'Everything Sunny stores',
              ],
              [
                'Google Gemini (Google Cloud)',
                'The AI that writes Sunny’s replies, understands speech and reads documents',
                'Messages, transcripts, emails and documents being worked on',
              ],
              [
                'Google Firebase Authentication',
                'Installer sign-in',
                'Installer email addresses and sign-in details',
              ],
              ['Stripe', 'Subscription payments', 'Installer billing details and email address'],
              [
                'Postmark (ActiveCampaign)',
                'Sending quotes by email, and receiving emails for the email assistant',
                'Email addresses and email content',
              ],
              [
                'Twilio',
                'Phone calls and text messages, for the voice add-on',
                'Phone numbers and the call’s audio while it happens',
              ],
              [
                'Cloudflare Turnstile',
                'Spam protection, if the installer turns it on',
                'IP address and browser information',
              ],
              [
                'Google (Gmail, Drive) and Microsoft (Outlook)',
                'Only when an installer connects their mailbox or a Drive folder',
                'Access to that mailbox or folder',
              ],
              [
                'Map and building data services: OpenStreetMap services (Nominatim, Photon, Overpass), postcodes.io, Overture Maps, Esri, the Environment Agency, the Scottish Government and the Welsh Government',
                'Finding a property and measuring its roof',
                'The address or postcode, or the map location of the building, but not your name or contact details',
              ],
            ]}
          />

          <h2 id="transfers">8. Information outside the UK</h2>
          <p>
            Sunny’s database is in London. Some providers above may process information in other
            countries, including the European Economic Area and the United States: in particular the
            AI provider, Stripe, Postmark, Twilio, Cloudflare and some map services. Where
            information leaves the UK, we rely on the safeguards UK law requires, such as UK
            adequacy regulations (including the UK Extension to the EU-US Data Privacy Framework) or
            the UK International Data Transfer Agreement or Addendum. You can ask us for details.
          </p>

          <h2 id="retention">9. How long we keep information</h2>
          <LegalTable
            label="How long we keep information"
            head={['Information', 'How long']}
            rows={[
              ['A visitor’s chat session', 'Two hours, in memory only'],
              [
                'Conversations, answers and transcripts',
                'Deleted automatically two years after the last message',
              ],
              [
                'Enquiries (leads) and the consent record',
                'Deleted automatically two years after they were made',
              ],
              [
                'Quotes and roof measurements',
                'Kept with the installer’s account, and deleted when the account closes or on request',
              ],
              ['IP addresses used to limit requests', 'Minutes, in memory only'],
              ['Server logs', '30 days'],
              [
                'Installer accounts and content',
                'While the account is open, then deleted within 90 days of it closing',
              ],
              [
                'Waitlist entries',
                'Until we have invited you to sign up, or you ask to be removed',
              ],
              ['Billing records', 'Six years, as UK tax law requires'],
              ['Backups', 'Seven days, then overwritten'],
            ]}
          />
          <p>An installer can ask us to delete an enquiry or conversation sooner at any time.</p>

          <h2 id="ai">10. AI and automated decisions</h2>
          <p>
            Sunny is an AI assistant, and it always says so. It answers from the installer’s own
            information, and its prices, savings and roof measurements are indicative estimates: the
            installer confirms everything after a survey. Sunny does not make decisions about you
            that have legal or similarly significant effects, and it does not score or rank you. A
            person at the installer decides whether and how to follow up.
          </p>
          <p>
            We use Google’s paid AI services, under terms that do not allow Google to use the
            content to train its models. We do not use your conversations to train AI models either.
          </p>

          <h2 id="security">11. How we protect information</h2>
          <ul>
            <li>Information is encrypted in transit and when stored.</li>
            <li>
              Each installer’s information is kept separate, and checks stop one installer seeing
              another’s.
            </li>
            <li>The chat only works on the websites an installer has registered.</li>
            <li>Access keys for connected mailboxes are stored encrypted.</li>
            <li>
              Access to our systems is limited to the people and services that need it, and
              important actions are logged.
            </li>
          </ul>
          <p>
            If a breach puts your information at risk, we will tell the installer concerned without
            undue delay, and the ICO and you where the law requires.
          </p>

          <h2 id="rights">12. Your rights</h2>
          <p>Under UK GDPR you have the right to:</p>
          <ul>
            <li>be told how your information is used (this policy);</li>
            <li>get a copy of your information;</li>
            <li>have it corrected if it is wrong;</li>
            <li>have it deleted;</li>
            <li>restrict or object to how it is used;</li>
            <li>receive it in a portable format, in some cases;</li>
            <li>withdraw consent at any time, where we rely on it.</li>
          </ul>
          <p>
            If you talked to Sunny on an installer’s website or phone line, please contact that
            installer, as they control your information; we will help them. Otherwise, contact us at{' '}
            {LEGAL.contactEmail}. We will reply within one month. There is normally no charge.
          </p>
          <p>
            If you are unhappy with how your information has been handled, you can complain to the
            Information Commissioner’s Office at{' '}
            <a href="https://ico.org.uk/make-a-complaint/">ico.org.uk/make-a-complaint</a> or on
            0303 123 1113. We would appreciate the chance to put things right first.
          </p>

          <h2 id="children">13. Children</h2>
          <p>
            Sunny is for adults arranging solar for their homes or businesses. It is not meant for
            children, and we do not knowingly collect information about anyone under 18.
          </p>

          <h2 id="changes">14. Changes to this policy</h2>
          <p>
            We will update this policy when Sunny changes. The date at the top shows when it was
            last updated. We will tell installers about significant changes before they take effect.
          </p>

          <h2 id="contact">15. Contact us</h2>
          <p>
            {LEGAL.companyName}, {LEGAL.registeredAddress}. Email: {LEGAL.contactEmail}.
          </p>
        </div>
      </section>
    </main>
  );
}
