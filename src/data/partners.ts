/**
 * 相棒。ガチャの SSR で手に入る、冒険の最初から連れて行けるモンスター。
 *
 * 新しいモンスターとして図鑑に足すのではなく、既にいるモンスターの
 * 見た目と特技を借りて、能力値と名前だけを差し替える。
 * こうすると AI・戦闘・スプライト・仲間の作戦が全部そのまま使える。
 *
 * 借りる相手は「味方が使っても理不尽にならない特技」のものだけにする。
 * 道具を盗む・呪うといった特技は、味方が使っても嬉しくない。
 */

export interface PartnerDef {
  id: string;
  /** 既定の名前。村で変えられる */
  name: string;
  /** 見た目と特技を借りるモンスターの id */
  baseId: string;
  desc: string;
  /** レベル 1 のときの値 */
  hp: number;
  atk: number;
  def: number;
  /** 1 レベル上がるごとの伸び */
  hpGrow: number;
  atkGrow: number;
  defGrow: number;
}

export const PARTNERS: readonly PartnerDef[] = [
  {
    id: 'koro', name: 'コロ', baseId: 'ratMud',
    desc: '素直に殴る。まれに 2 回 攻撃する。',
    hp: 24, atk: 9, def: 2, hpGrow: 6, atkGrow: 3.2, defGrow: 0.9,
  },
  {
    id: 'yoi', name: 'ヨイ', baseId: 'batBlood',
    desc: '吸血で 自分の HP を 戻す。倒れにくい。',
    hp: 20, atk: 8, def: 2, hpGrow: 5, atkGrow: 3.0, defGrow: 0.8,
  },
  {
    id: 'goro', name: 'ゴロ', baseId: 'archerRock',
    desc: '離れた 相手に 石を 投げる。',
    hp: 22, atk: 7, def: 3, hpGrow: 5, atkGrow: 2.8, defGrow: 1.0,
  },
  {
    id: 'mina', name: 'ミナ', baseId: 'mageAdept',
    desc: '敵を 眠らせる・混乱させる。',
    hp: 18, atk: 6, def: 2, hpGrow: 4, atkGrow: 2.4, defGrow: 0.8,
  },
  {
    id: 'utsuro', name: 'ウツロ', baseId: 'ghostGrudge',
    desc: '触れた 相手を 動けなくする。壁を すり抜ける。',
    hp: 22, atk: 8, def: 3, hpGrow: 5, atkGrow: 2.9, defGrow: 1.0,
  },
  {
    id: 'tetsu', name: 'テツ', baseId: 'metalKing',
    desc: '極端に 硬い。攻撃は 伸びない。',
    hp: 14, atk: 5, def: 22, hpGrow: 2, atkGrow: 1.2, defGrow: 1.6,
  },
];

const partnerMap = new Map(PARTNERS.map((p) => [p.id, p]));

export const tryGetPartner = (id: string): PartnerDef | undefined => partnerMap.get(id);
