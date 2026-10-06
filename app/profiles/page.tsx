import { permanentRedirect } from "next/navigation";

/**
 * The directory moved to `/s/[series]`. This stub keeps old links (and search
 * engines) working with a permanent redirect; account routes under
 * `/profiles/*` are unaffected.
 */
export default function ProfilesPage() {
  permanentRedirect("/s/24");
}
