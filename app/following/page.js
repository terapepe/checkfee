'use client';
import { TokenBoard } from '../launches/board';
import { listFollowing } from '../../lib/market';

export default function Following() {
  return <TokenBoard source={listFollowing} title="Following" desc="Tokens followed by the community. Any connected wallet can follow or unfollow from a token page." />;
}
