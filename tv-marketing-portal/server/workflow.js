// Ticket workflow rules: statuses per board, which ones run the clock,
// and the dropdown categories seeded on first run.

export const BOARDS = {
  ae: {
    label: 'Assistant Editor',
    prefix: 'AE',
    manageCategory: 'manage_ae',
    statuses: ['Draft', 'Queued', 'In Progress', 'On Hold', 'Out for Approval', 'Completed', 'Cancelled'],
    assignedStatus: 'Queued',
    // The clock runs only while work is actually happening.
    timed: ['In Progress'],
    manualEditStatuses: ['On Hold', 'Completed'],
  },
  editorial: {
    label: 'Editorial Scheduling',
    prefix: 'ED',
    manageCategory: 'manage_editorial',
    statuses: [
      'Draft', 'Scheduled', 'In Progress', 'On Hold', 'Out to Creative Review', 'Out for Client Review',
      'Out for Legal Review', 'Applying Client Notes', 'Applying Legal', 'Out for Final Approval',
      'Final Notes', 'Final Lock', 'Shipped', 'Ready for Backup', 'Archived', 'Cancelled',
    ],
    assignedStatus: 'Scheduled',
    timed: ['In Progress', 'Applying Client Notes', 'Applying Legal', 'Final Notes'],
    // Anything not timed and past Draft/Scheduled can be corrected by hand.
    manualEditStatuses: [
      'On Hold', 'Out to Creative Review', 'Out for Client Review', 'Out for Legal Review',
      'Out for Final Approval', 'Final Lock', 'Shipped', 'Ready for Backup', 'Archived',
    ],
    // Pseudo-statuses: picking one runs an action instead of changing the status.
    actions: ['Unarchive', 'Cut-Down'],
    bookingCushionDays: 2,
  },
  finishing: {
    label: 'Finishing',
    prefix: 'FN',
    manageCategory: 'manage_finishing',
    statuses: ['Draft', 'Queued', 'In Progress', 'On Hold', 'Completed', 'Cancelled'],
    assignedStatus: 'Queued',
    timed: [], // finishing time is tracked per track (picture / sound)
    manualEditStatuses: ['On Hold', 'Completed'],
  },
};

export const FINISHING_TRACK_STATUSES = [
  'Prep Requested', 'Prep In Progress', 'Ready for Review', 'Ready for Delivery', 'Prep Sent',
  'Ready to Review', 'Under Review', 'Approved', 'On Hold', 'Completed',
];
export const FINISHING_TIMED = ['Prep In Progress'];

export const PROJECT_STATUSES = ['Active', 'On Hold', 'Completed', 'Cancelled', 'Killed'];
export const HR_STATUSES = ['Pending Review', 'Verified', 'Dates Confirmed', 'Sent to IT'];
export const IT_STATUSES = ['Waiting on HR', 'Not Started', 'In Progress', 'Ready'];
export const MESSAGE_KINDS = ['Note', 'Review Link', 'Approval Request'];
export const REVIEW_STATUSES = ['Pending', 'Approved', 'Changes Requested', 'Rejected', 'Info'];

export const PERMISSIONS = {
  admin: 'Everything, including users and dropdown options',
  onboarding: 'Create/edit personnel, clients, projects, accounts, media, equipment',
  view_financials: 'See budgets, estimated cost, differential and pay rates',
  manage_ae: 'Assign and manage the Assistant Editor board',
  manage_editorial: 'Assign and manage the Editorial Scheduling board',
  manage_finishing: 'Assign and manage the Finishing board',
  hr: 'HR personnel board (verify data, confirm dates, pay)',
  it: 'IT setup board (no pay data)',
  import: 'Import records from files and screenshots',
};

export const DEFAULT_OPTIONS = {
  department: [
    ['Creative', 'CR'], ['Editorial', 'ED'], ['Assistant Editorial', 'AE'], ['Finishing', 'FN'],
    ['Audio', 'AU'], ['Graphics', 'GR'], ['Production', 'PR'], ['Print', 'PT'], ['Digital', 'DG'],
    ['Account Management', 'AM'], ['Operations', 'OP'],
  ],
  sector: ['Theatrical', 'Streaming', 'Network TV', 'Cable', 'Gaming', 'Brand', 'Music', 'Sports'],
  client_department: ['Marketing', 'Creative Advertising', 'Publicity', 'Digital Marketing', 'Brand Partnerships', 'Media'],
  employment_type: ['Staff', 'Freelance', 'Contractor', 'Intern'],
  rate_frequency: ['Hourly', 'Daily', 'Weekly', 'Bi-weekly', 'Monthly', 'Annual', 'Flat / Per Project'],
  title: ['Editor', 'Senior Editor', 'Assistant Editor', 'Producer', 'Senior Producer', 'Coordinator', 'Finishing Artist', 'Colorist', 'Mixer', 'Designer', 'Writer', 'Manager'],
  scope_of_work: ['Print Campaign', 'Trailer', 'Digitals', 'TV', 'Out of Home', 'Production', 'Finishing', 'Graphics', 'Key Art', 'Experiential', 'Sizzle', 'Tribute', 'Pitch', 'Reel'],
  media_type: ['Hard Drive', 'SSD', 'LTO Tape', 'Camera Card', 'Blu-ray', 'DVD', 'HDCAM', 'Thumb Drive'],
  equipment_type: ['Workstation', 'Laptop', 'Monitor', 'Reference Monitor', 'Audio Interface', 'Speakers', 'Headphones', 'Storage', 'Deck', 'Camera', 'Peripheral'],
  ae_category: ['Ingest', 'Cue Sheets', 'Screeners', 'Clip Pulls', 'Creative', 'Preps', 'Other'],
  duration: [':06', ':10', ':15', ':20', ':30', ':45', ':60', '1:30', '2:00', '2:30'],
  workstation_location: ['Bay 1', 'Bay 2', 'Bay 3', 'AE Pod', 'Finishing Suite', 'Mix Stage', 'Remote'],
  software: ['Avid Media Composer', 'Premiere Pro', 'After Effects', 'DaVinci Resolve', 'Pro Tools', 'Photoshop', 'Frame.io', 'Slack', 'Office 365'],
  hardware: ['Mac Studio', 'Mac Pro', 'MacBook Pro', 'PC Workstation', 'Dual Monitors', 'Reference Monitor', 'Headphones'],
};

export function isTimed(board, status) {
  return BOARDS[board].timed.includes(status);
}
