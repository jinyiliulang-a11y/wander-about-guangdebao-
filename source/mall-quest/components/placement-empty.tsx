"use client";

import { PenLine } from "lucide-react";
import { Empty } from "./common/Empty";

const emptyDescriptions: Record<string, string> = {
  pending: "目前没有待审核的作品。",
  published: "目前没有寻宝中的作品。",
  found: "目前没有已被发现的作品。",
  expired: "目前没有已过期的作品。",
  rejected: "目前没有待修改的作品。",
  offline: "目前没有已下架的作品。",
};

export function PlacementEmpty({ filter, hasPlacements, onCreate, onShowAll }: {
  filter: string;
  hasPlacements: boolean;
  onCreate: () => void;
  onShowAll: () => void;
}) {
  if (filter === "all" && !hasPlacements) {
    return <Empty
      icon={PenLine}
      title="你的第一个宝藏，等你来写"
      body="把熟悉的角落，变成别人的新发现。"
      action={<button type="button" className="gold-button" onClick={onCreate}>创作第一条线索</button>}
    />;
  }

  return <Empty
    icon={PenLine}
    title="空空如也"
    body={emptyDescriptions[filter] || "目前没有符合筛选条件的作品。"}
    action={<button type="button" className="outline-button" onClick={onShowAll}>查看全部作品</button>}
  />;
}
