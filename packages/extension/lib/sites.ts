export interface SiteConfig {
  id: "tms" | "banner";
  /** Content-script match patterns. */
  matches: string[];
  /** Selector for the element whose text is the instructor name(s). */
  instructorSelector: string;
  /**
   * Where the badge goes relative to that element: "append" inside it, or "after" it
   * (needed when the element is itself a link, so badge clicks don't trigger it).
   */
  badgePlacement: "append" | "after";
}

/**
 * Term Master Schedule course list (fixtures/tms.html). The instructor is the last cell of
 * each course row and has no class of its own. Rows get odd/even from the table plugin; the
 * nested day/time table's rows don't, which keeps its last cell (the time) out.
 */
export const TMS_CONFIG: SiteConfig = {
  id: "tms",
  matches: ["https://termmasterschedule.drexel.edu/webtms_du/*"],
  instructorSelector: "tr.odd > td:last-child, tr.even > td:last-child",
  badgePlacement: "append",
};

/**
 * Banner 9 class search / registration (fixtures/banner.html). Each instructor is its own
 * mailto link inside td[data-property="instructor"]; "(Primary)" sits outside the link, and
 * multiple instructors are separated by <br>, so targeting links yields one clean name each.
 */
export const BANNER_CONFIG: SiteConfig = {
  id: "banner",
  matches: ["https://banner.drexel.edu/registration/ssb/*"],
  instructorSelector: 'td[data-property="instructor"] a.email',
  badgePlacement: "after",
};
