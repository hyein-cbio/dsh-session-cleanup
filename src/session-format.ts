import { homedir } from "node:os";

export function shortenPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }

  return path;
}

export function formatSessionAge(date: Date, now = Date.now()): string {
  const ageMs = Math.max(0, now - date.getTime());
  const minutes = Math.floor(ageMs / 60000);

  if (minutes < 1) {
    return "now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }

  if (days < 30) {
    return `${Math.floor(days / 7)}w`;
  }

  if (days < 365) {
    return `${Math.floor(days / 30)}mo`;
  }

  return `${Math.floor(days / 365)}y`;
}
