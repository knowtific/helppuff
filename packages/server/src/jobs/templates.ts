/**
 * Pipeline templates: the stages and fields a kind of business starts with.
 * Data, not code: adding one is adding an entry (a test checks each is
 * valid). The AI chooses one from the website at set-up (`jobs/setup.ts`)
 * and may customise it; the owner edits anything afterwards.
 *
 * Every template ends in at least one `won` and one `lost` stage. Every field
 * carries the question the assistant and the widget's quote questions ask.
 */

export type StageKind = 'open' | 'won' | 'lost';
export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'email', 'tel'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type TemplateStage = { name: string; kind: StageKind; color: string; rotDays?: number };
export type TemplateField = { name: string; label: string; type: FieldType; required?: boolean; options?: string[]; question: string; quote?: boolean };
export type Template = {
  id: string;
  name: string;
  /** For whom: shown in Settings, and what the AI reads to choose. */
  description: string;
  stages: TemplateStage[];
  fields: TemplateField[];
};

const GREY = '#6b7280';
const BLUE = '#3b82f6';
const VIOLET = '#8b5cf6';
const AMBER = '#f59e0b';
const TEAL = '#14b8a6';
const GREEN = '#22c55e';
const RED = '#ef4444';

const description: TemplateField = { name: 'description', label: 'Description', type: 'textarea', required: true, question: 'What do you need? A sentence or two is plenty.', quote: true };

export const TEMPLATES: Template[] = [
  {
    id: 'service-quote',
    name: 'Service quote',
    description: 'Trades and home or business services that quote before the work: plumbing, electrical, building repairs, cleaning, landscaping, removals, pest control, painting.',
    stages: [
      { name: 'New request', kind: 'open', color: BLUE, rotDays: 1 },
      { name: 'Site visit', kind: 'open', color: VIOLET, rotDays: 3 },
      { name: 'Quote sent', kind: 'open', color: AMBER, rotDays: 7 },
      { name: 'Booked', kind: 'open', color: TEAL, rotDays: 14 },
      { name: 'In progress', kind: 'open', color: GREY, rotDays: 14 },
      { name: 'Done', kind: 'won', color: GREEN },
      { name: 'Lost', kind: 'lost', color: RED },
    ],
    fields: [
      { name: 'service', label: 'Service', type: 'select', options: [], question: 'Which service do you need?', quote: true },
      description,
      { name: 'address', label: 'Address or suburb', type: 'text', required: true, question: 'Where is the job? An address or suburb.', quote: true },
      { name: 'urgency', label: 'Urgency', type: 'select', options: ['Emergency', 'This week', 'Within a month', 'Flexible'], question: 'How soon do you need it?', quote: true },
      { name: 'preferred_date', label: 'Preferred date', type: 'date', question: 'Is there a day that suits you?' },
      { name: 'property_type', label: 'Property type', type: 'select', options: ['House', 'Apartment', 'Commercial'], question: 'What kind of property is it?' },
    ],
  },
  {
    id: 'projects',
    name: 'Projects',
    description: 'Agencies, studios, builders, architects, consultants and designers who scope and propose projects.',
    stages: [
      { name: 'New enquiry', kind: 'open', color: BLUE, rotDays: 2 },
      { name: 'Discovery call', kind: 'open', color: VIOLET, rotDays: 7 },
      { name: 'Proposal sent', kind: 'open', color: AMBER, rotDays: 10 },
      { name: 'Negotiation', kind: 'open', color: TEAL, rotDays: 14 },
      { name: 'Won', kind: 'won', color: GREEN },
      { name: 'Lost', kind: 'lost', color: RED },
    ],
    fields: [
      { name: 'project_type', label: 'Project type', type: 'select', options: [], question: 'What kind of project is it?', quote: true },
      description,
      { name: 'budget', label: 'Budget', type: 'select', options: ['Under $5k', '$5k–$20k', '$20k–$50k', 'Over $50k', 'Not sure yet'], question: 'Roughly what budget do you have in mind?', quote: true },
      { name: 'timeline', label: 'Timeline', type: 'text', question: 'When would you like it done?', quote: true },
      { name: 'company', label: 'Company', type: 'text', question: 'Which company is it for?' },
    ],
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Software and SaaS products helping existing customers: questions, problems and bug reports.',
    stages: [
      { name: 'New', kind: 'open', color: BLUE, rotDays: 1 },
      { name: 'Triage', kind: 'open', color: VIOLET, rotDays: 1 },
      { name: 'In progress', kind: 'open', color: AMBER, rotDays: 3 },
      { name: 'Waiting on customer', kind: 'open', color: GREY, rotDays: 7 },
      { name: 'Resolved', kind: 'won', color: GREEN },
      { name: "Won't fix", kind: 'lost', color: RED },
    ],
    fields: [
      { name: 'product_area', label: 'Product area', type: 'select', options: [], question: 'Which part of the product is it about?', quote: true },
      { name: 'priority', label: 'Priority', type: 'select', options: ['Urgent: blocked', 'High', 'Normal', 'Low'], question: 'How much is it getting in your way?', quote: true },
      { name: 'description', label: 'What happened', type: 'textarea', required: true, question: 'What happened, and what did you expect?', quote: true },
      { name: 'account', label: 'Account or plan', type: 'text', question: 'Which account or plan is it on?' },
      { name: 'steps', label: 'Steps to reproduce', type: 'textarea', question: 'How can we see it happen?' },
    ],
  },
  {
    id: 'sales-demo',
    name: 'Sales (demo)',
    description: 'SaaS and B2B products selling to businesses: "Book a demo", "Contact sales", trials.',
    stages: [
      { name: 'Demo request', kind: 'open', color: BLUE, rotDays: 2 },
      { name: 'Qualified', kind: 'open', color: VIOLET, rotDays: 5 },
      { name: 'Demo booked', kind: 'open', color: AMBER, rotDays: 7 },
      { name: 'Trial', kind: 'open', color: TEAL, rotDays: 14 },
      { name: 'Won', kind: 'won', color: GREEN },
      { name: 'Lost', kind: 'lost', color: RED },
    ],
    fields: [
      { name: 'company', label: 'Company', type: 'text', required: true, question: 'Which company are you with?', quote: true },
      { name: 'company_size', label: 'Company size', type: 'select', options: ['1–10', '11–50', '51–200', '201–1000', '1000+'], question: 'How many people work there?', quote: true },
      { name: 'use_case', label: 'Use case', type: 'textarea', required: true, question: 'What would you like to use it for?', quote: true },
      { name: 'current_tool', label: 'Current tool', type: 'text', question: 'What do you use for this today?' },
    ],
  },
  {
    id: 'bookings',
    name: 'Bookings',
    description: 'Appointment-based businesses: salons, clinics, physios, tutors, studios, classes, rentals.',
    stages: [
      { name: 'Request', kind: 'open', color: BLUE, rotDays: 1 },
      { name: 'Confirmed', kind: 'open', color: TEAL, rotDays: 30 },
      { name: 'Completed', kind: 'won', color: GREEN },
      { name: 'Cancelled', kind: 'lost', color: RED },
    ],
    fields: [
      { name: 'service', label: 'Service', type: 'select', required: true, options: [], question: 'Which service would you like to book?', quote: true },
      { name: 'preferred_time', label: 'Preferred date and time', type: 'text', required: true, question: 'When would suit you?', quote: true },
      { name: 'people', label: 'Number of people', type: 'number', question: 'For how many people?' },
      { name: 'notes', label: 'Notes', type: 'textarea', question: 'Anything we should know?', quote: true },
    ],
  },
  {
    id: 'custom-orders',
    name: 'Custom orders',
    description: 'Retail and makers taking custom, bulk or wholesale orders: furniture, printing, catering, florists, gifts.',
    stages: [
      { name: 'Enquiry', kind: 'open', color: BLUE, rotDays: 2 },
      { name: 'Quoted', kind: 'open', color: AMBER, rotDays: 7 },
      { name: 'Paid', kind: 'open', color: TEAL, rotDays: 14 },
      { name: 'Delivered', kind: 'won', color: GREEN },
      { name: 'Lost', kind: 'lost', color: RED },
    ],
    fields: [
      { name: 'product', label: 'Product', type: 'select', options: [], question: 'Which product is it for?', quote: true },
      { name: 'quantity', label: 'Quantity', type: 'number', question: 'How many?', quote: true },
      { name: 'needed_by', label: 'Needed by', type: 'date', question: 'When do you need it by?', quote: true },
      description,
      { name: 'delivery_address', label: 'Delivery address', type: 'text', question: 'Where should it be delivered?' },
    ],
  },
  {
    id: 'basic',
    name: 'Basic',
    description: 'Anything else: a simple pipeline to start from.',
    stages: [
      { name: 'New', kind: 'open', color: BLUE, rotDays: 3 },
      { name: 'Quote sent', kind: 'open', color: AMBER, rotDays: 7 },
      { name: 'In progress', kind: 'open', color: TEAL, rotDays: 14 },
      { name: 'Done', kind: 'won', color: GREEN },
      { name: 'Cancelled', kind: 'lost', color: RED },
    ],
    fields: [description],
  },
];

export const BASIC = 'basic';
export const templateById = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);
