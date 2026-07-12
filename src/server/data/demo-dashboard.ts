import "server-only";

const hoursFromNow = (hours: number) => new Date(Date.now() + hours * 3_600_000);

export function getDemoCommandCenterData() {
  return {
    organizationName: "Northstar Post · Demo workspace",
    dashboard: {
      metrics: { activeEpisodes: 11, episodesInReview: 4, qcAttention: 2, upcomingDeliveries: 5 },
      tasks: [],
      reviewQueue: [],
      episodes: [
        { id: "demo-e1", title: "The Quiet Hour", number: 1, status: "editor_cut", qcStatus: "in_progress", deliveryDeadline: hoursFromNow(46), showTitle: "Signal North", seasonNumber: 1 },
        { id: "demo-e2", title: "Second Skin", number: 2, status: "review", qcStatus: "not_started", deliveryDeadline: hoursFromNow(72), showTitle: "Signal North", seasonNumber: 1 },
        { id: "demo-e3", title: "Tin Roof", number: 3, status: "online", qcStatus: "in_progress", deliveryDeadline: hoursFromNow(96), showTitle: "Signal North", seasonNumber: 1 },
        { id: "demo-e4", title: "Borrowed Light", number: 4, status: "locked", qcStatus: "passed", deliveryDeadline: hoursFromNow(30), showTitle: "Signal North", seasonNumber: 1 },
        { id: "demo-e5", title: "The Undertow", number: 1, status: "review", qcStatus: "needs_attention", deliveryDeadline: hoursFromNow(24), showTitle: "Under Current", seasonNumber: 1 },
        { id: "demo-e6", title: "Salt Lines", number: 2, status: "editor_cut", qcStatus: "in_progress", deliveryDeadline: hoursFromNow(125), showTitle: "Under Current", seasonNumber: 1 },
        { id: "demo-e7", title: "The Still", number: 3, status: "online", qcStatus: "needs_attention", deliveryDeadline: hoursFromNow(60), showTitle: "Blackwater", seasonNumber: 1 },
        { id: "demo-e8", title: "The Rook", number: 2, status: "delivered", qcStatus: "passed", deliveryDeadline: hoursFromNow(-18), showTitle: "Blackwater", seasonNumber: 1 },
      ],
      activity: [
        { id: "a1", action: "episode.status_updated", entityType: "episode", entityId: "demo-e4", metadata: { from: "review", to: "locked" }, createdAt: hoursFromNow(-1) },
        { id: "a2", action: "qc.issue_created", entityType: "episode", entityId: "demo-e7", metadata: { issueCount: 2 }, createdAt: hoursFromNow(-2) },
        { id: "a3", action: "review.cut_submitted", entityType: "review_cut", entityId: "rc2", metadata: { recipient: "Mara Voss" }, createdAt: hoursFromNow(-4) },
        { id: "a4", action: "delivery.requirement_completed", entityType: "deliverable", entityId: "d1", metadata: { requirement: "5.1 audio stems" }, createdAt: hoursFromNow(-7) },
        { id: "a5", action: "booking.confirmed", entityType: "booking", entityId: "b1", metadata: { suite: "Color Suite 1" }, createdAt: hoursFromNow(-10) },
        { id: "a6", action: "budget.line_updated", entityType: "budget_line", entityId: "bl3", metadata: { category: "VFX" }, createdAt: hoursFromNow(-15) },
      ],
    },
    showRows: [
      { id: "show-1", title: "Signal North", code: "SN", network: "Northstar Network", seasons: [{ id: "s1", number: 1, episodeCount: 8, activeEpisodeCount: 6 }] },
      { id: "show-2", title: "Under Current", code: "UC", network: "Harbour+", seasons: [{ id: "s2", number: 1, episodeCount: 8, activeEpisodeCount: 5 }] },
      { id: "show-3", title: "Blackwater", code: "BW", network: "N5", seasons: [{ id: "s3", number: 1, episodeCount: 6, activeEpisodeCount: 3 }] },
    ],
    deliverables: [
      { id: "d1", name: "Network picture master", destination: "Northstar Network", status: "ready", dueAt: hoursFromNow(24), deliveredAt: null, episodeTitle: "Borrowed Light", episodeNumber: 4, showTitle: "Signal North", requirements: [] },
      { id: "d2", name: "International M&E package", destination: "Distribution vault", status: "in_progress", dueAt: hoursFromNow(30), deliveredAt: null, episodeTitle: "Borrowed Light", episodeNumber: 4, showTitle: "Signal North", requirements: [] },
      { id: "d3", name: "Streaming captions", destination: "Harbour+", status: "ready", dueAt: hoursFromNow(48), deliveredAt: null, episodeTitle: "The Undertow", episodeNumber: 1, showTitle: "Under Current", requirements: [] },
      { id: "d4", name: "5.1 + stereo audio stems", destination: "N5 MediaHub", status: "qc", dueAt: hoursFromNow(60), deliveredAt: null, episodeTitle: "The Still", episodeNumber: 3, showTitle: "Blackwater", requirements: [] },
      { id: "d5", name: "Textless master", destination: "Northstar Network", status: "in_progress", dueAt: hoursFromNow(96), deliveredAt: null, episodeTitle: "Tin Roof", episodeNumber: 3, showTitle: "Signal North", requirements: [] },
    ],
    schedule: [
      { id: "b1", title: "SN101 editor’s cut", startsAt: hoursFromNow(2), endsAt: hoursFromNow(34), status: "confirmed", roomName: "Edit Bay 1", roomType: "edit_bay", episodeTitle: "The Quiet Hour", episodeNumber: 1, personName: "James Liu" },
      { id: "b2", title: "UC202 editor’s cut", startsAt: hoursFromNow(3), endsAt: hoursFromNow(11), status: "confirmed", roomName: "Edit Bay 2", roomType: "edit_bay", episodeTitle: "Salt Lines", episodeNumber: 2, personName: "Leah Morgan" },
      { id: "b3", title: "SN103 grade pass", startsAt: hoursFromNow(26), endsAt: hoursFromNow(70), status: "confirmed", roomName: "Color Suite 1", roomType: "color_suite", episodeTitle: "Tin Roof", episodeNumber: 3, personName: "Priya Shah" },
      { id: "b4", title: "SN104 final mix", startsAt: hoursFromNow(28), endsAt: hoursFromNow(53), status: "confirmed", roomName: "Mix Stage A", roomType: "mix_room", episodeTitle: "Borrowed Light", episodeNumber: 4, personName: "Eli Bennett" },
      { id: "b5", title: "BW103 technical QC", startsAt: hoursFromNow(42), endsAt: hoursFromNow(48), status: "confirmed", roomName: "QC Room 1", roomType: "qc_room", episodeTitle: "The Still", episodeNumber: 3, personName: "Ruth Okafor" },
      { id: "b6", title: "SN105 assembly", startsAt: hoursFromNow(50), endsAt: hoursFromNow(82), status: "hold", roomName: "Edit Bay 1", roomType: "edit_bay", episodeTitle: "The Long View", episodeNumber: 5, personName: "Leah Morgan" },
    ],
    budget: {
      lines: [], billables: [],
      totals: { budgeted: 414000, actual: 371820 },
    },
    team: [
      { id: "p1", name: "Maya Ortiz", email: "maya@northstar-post.test", role: "post_supervisor", company: null, isActive: true, userImage: null, organizationRole: "owner" },
      { id: "p2", name: "James Liu", email: "james@northstar-post.test", role: "editor", company: null, isActive: true, userImage: null, organizationRole: "member" },
      { id: "p3", name: "Leah Morgan", email: "leah@northstar-post.test", role: "editor", company: null, isActive: true, userImage: null, organizationRole: "member" },
      { id: "p4", name: "Priya Shah", email: "priya@northstar-post.test", role: "colorist", company: null, isActive: true, userImage: null, organizationRole: "member" },
      { id: "p5", name: "Eli Bennett", email: "eli@northstar-post.test", role: "sound_mixer", company: null, isActive: true, userImage: null, organizationRole: "member" },
      { id: "p6", name: "Ruth Okafor", email: "ruth@northstar-post.test", role: "qc", company: null, isActive: true, userImage: null, organizationRole: "member" },
    ],
  };
}
