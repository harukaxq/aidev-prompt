ultrathink
アーキテクチャ、実装計画書に従い実装を行いなさい。必ずspec/initial.mdを参照しなさい。保存可能ならspec/{yyyy-mm-dd-hh-mm}-{機能名}-report.mdに実装レポートをimplementation_report_templateに従って保存しなさい。

<architecture>
## 0. 目的
本ドキュメントではディレクトリ構造と開発ルール、依存方向、命名規則を体系的に示します。

---

## 1. ディレクトリ構成の全体図

```text
src/
├── lib/
│   └── server/
│       ├── features/            # ドメインごとのビジネスロジック
│       │   └── <Domain>/
│       │       ├── core/        # 純粋関数・ドメイン知識
│       │       │   ├── <Domain>.ts
│       │       │   └── policy/
│       │       │       └── <Policy>.ts
│       │       ├── command/
│       │       │   ├── <Command>/
│       │       │   │   ├── core.ts
│       │       │   │   └── handler.ts
│       │       │   └── _<InternalCommand>/  # 内部専用（_prefix）
│       │       │       ├── core.ts
│       │       │       └── handler.ts
│       │       └── query/
│       │           ├── <Query>/
│       │           │   ├── core.ts
│       │           │   └── handler.ts
│       │           └── _<InternalQuery>/     # 内部専用（_prefix）
│       │               ├── core.ts
│       │               └── handler.ts
│       ├── flows/               # 複数ドメインを束ねる Orchestrator
│       │   └── <Flow>/handler.ts
│       ├── adapter/             # 技術依存 (外部 API / DB / LLM …)
│       │   ├── repository/      # DB永続化実装
│       │   └── service/         # 外部API連携実装
│       ├── shared/              # ドメイン横断ユーティリティ
│       │   ├── port/            # 抽象インターフェース
│       │   │   ├── repository/  # リポジトリインターフェース
│       │   │   └── service/     # サービスインターフェース
│       │   └── container.ts     # DIコンテナ（依存関係の解決）
│       ├── entrypoint/          # 非HTTPエントリーポイント
│       │   ├── cron.ts          # スケジュール実行
│       │   └── cli.ts           # CLIコマンド実行
│       └── auth.ts              # 認証設定とヘルパー関数
└── routes/                      # SvelteKitルーティング（HTTPレイヤー）
    ├── [ページパス]/            # ページ用ルート
    │   ├── +page.svelte         # ページコンポーネント
    │   └── +page.server.ts      # サーバーサイド処理（load, actions）
    └── api/                     # 外部システム用APIエンドポイント
        └── [path]/+server.ts    # webhook、外部アプリ連携など
```

---

## 2. アーキテクチャ原則

### 2.1 サーバー・クライアント分離
- **サーバー側**: `/lib/server/` 配下にビジネスロジックを配置
- **クライアント側**: `/lib/features/<Domain>/client/` 配下にAPI呼び出しとUI表示ヘルパーを配置
- **DI使用**: shared/container.ts でPortと実装の紐付けを一元管理

### 2.2 レイヤ責務と依存方向

| レイヤ               | 役割                                      | 依存できる相手               |
| ----------------- | --------------------------------------- | --------------------- |
| **core/**         | ビジネスロジックを純粋関数で実装。副作用ゼロ                  |                       |
| **policy/**       | 複数エンティティにまたがるドメイン規則                     | core/                 |
| **shared/port/**  | 外部との境界面（interface のみ）                   | —                     |
| **container.ts**  | DIコンテナ。Portと実装の紐付けを管理                    | port/, adapter/       |
| **command/query** | UseCase。DIコンテナ経由で実装を取得                    | core/, container, shared/port/ |
| **flows/**        | 複数ドメインの command/query を呼び出し順序を制御        | command/query         |
| **adapter/**      | 外部サービス実装（I/O）                           | shared/port/          |
| **entrypoint/**   | 非HTTPエントリーポイント（cron, cli）                 | auth.ts, flows/, command/query |
| **auth.ts**       | 認証設定とヘルパー関数（requireAuth, requireAdmin）    | adapter/, features/   |
| **routes/[page]/**| ページルート（+page.server.ts でサーバー処理）        | auth.ts, flows/, command/query |
| **routes/api/**   | 外部システム用API（webhook、モバイルアプリ等）        | auth.ts, flows/, command/query |

### 2.3 ドメイン間の独立性

**重要原則**: features/配下の異なるドメイン間での直接的な依存は**厳禁**です。

| 禁止事項 | 理由 | 正しい実装方法 |
| ------- | ---- | ------------ |
| features/user から features/payment を import | ドメイン境界の破壊 | flows/ でオーケストレーション |
| features/order から features/product/query を直接呼び出し | 密結合の発生 | flows/order-product で結合 |
| features間での型の共有 | 変更の波及範囲拡大 | shared/types に共通型を配置 |

**実装例**:
```ts
// ❌ 悪い例: features/order/command/create-order/handler.ts
import { getProduct } from '../../../product/query/get-product/handler' // 禁止！

// ✅ 良い例: flows/create-order-with-products/handler.ts
import { createOrder } from '../../features/order/command/create-order/handler'
import { getProduct } from '../../features/product/query/get-product/handler'

export async function createOrderWithProducts(input: CreateOrderInput) {
  const products = await Promise.all(
    input.productIds.map(id => getProduct({ id }))
  )
  return await createOrder({ ...input, products })
}
```

---

## 3. コーディングガイドライン

### 3.0 SvelteKitルーティング設計方針

#### ページルート（推奨）
* **基本原則**: ページで使用するデータの取得・更新は `+page.server.ts` で処理
* **load関数**: ページ表示に必要なデータを取得
* **actions**: フォーム送信によるデータ更新処理
* **例**: 管理画面、ユーザー画面、設定画面など

#### APIルート（特殊ケースのみ）
* `/api/` 配下は以下の特殊なケースでのみ使用：
  * **Webhook**: 外部サービスからのコールバック（例: LINE WORKS callback）
  * **外部アプリ連携**: モバイルアプリ、WOFFアプリなどSvelteKit外からのアクセス
  * **サードパーティ連携**: 他システムとのAPI連携
* **避けるべき例**: 管理画面のデータ取得・更新（→ +page.server.ts を使用）

### 3.1 core/

* Prisma のモデル型を **Readonly 型** として再利用
* 不変条件は Factory 関数 (`createXxx`) で保証
* 副作用（日時取得・UUID 生成も含む）は一切禁止

### 3.2 command/query/

* `core.ts` は入力検証・派生データ計算などを純粋関数で実装
* `handler.ts` では **直接実装インスタンス** を使用して副作用を実行
* 1 ファイル 200 行を超えたらロジックを core/ へ抽出

### 3.3 flows/

* 既存 command/query を **2 つ以上** 結合する場合のみ作成
* ビジネス条件分岐が 20 行を超える場合、判断部分を pure 関数に切り出す

### 3.4 adapter/

* 外部 API へのリトライ・サーキットブレーカは adapter 内にカプセル化
* ドメイン語彙を adapter に持ち込まない。必要なら mapper を挟む
* クラスでServiceやRepositoryを定義
* ChatModelやPrismaをそのまま返したりせず、invoke()や、query()などのメソッドを公開する
* adapter/repositoryにはリポジトリを定義。DBへのアクセスはRepository経由で行う
* adapter/serviceにはサービスを定義。LLM呼び出しや、外部API呼び出しはService経由で行う
* shared/port/repository/にProductRepositoryなど、shared/port/service/にPaymentServiceなどの抽象化層を作成し実態をadapterに記述 

### 3.5 policy/
* core/で使う制約などを記載
* 単純すぎるものはcore/<Domain>.tsでチェックする
* 例えばOrderにCouponが設定できるかチェックする(canApplyCoupon)など

### 3.6 認証設計
* **ライブラリ依存**: 認証ロジックは基本的にライブラリ（Lucia、Auth.js等）に任せる
* **最小限のUser実装**: 他のModelで参照するため、必要最小限のUserエンティティのみ実装
* **auth.ts**: 認証ヘルパー関数（requireAuth, requireAdmin）を集約
* **セッション管理**: ライブラリの機能を使用、独自実装は避ける
* **実装例**:
  ```ts
  // src/lib/server/features/user/core/user.ts
  export type User = {
    id: string
    email: string
    name: string
    role: 'user' | 'admin'
  }
  ```

### 3.7 内部専用command/queryの命名規則
* **_prefix**: flow、entrypoint、routesに公開しないcommand/queryは`_`で開始
* **目的**: Model内部でのみ使用するコマンドを明確に区別
* **例**:
  - `_sync-cache`: キャッシュ同期（内部処理）
  - `_calculate-stats`: 統計計算（他のcommandから呼ばれる）
  - `_validate-data`: データ検証（内部利用のみ）
* **利用制限**: _prefixのcommand/queryはfeature外から直接呼び出し禁止

---

## 4. 実装パターン

### 4.1 DIコンテナ実装パターン

```ts
// src/lib/server/shared/container.ts
import type { UserRepository } from './port/repository/userRepository'
import type { PaymentService } from './port/service/paymentService'
import { UserRepositoryPrisma } from '../adapter/repository/userRepository.prisma'
import { PaymentServiceStripe } from '../adapter/service/paymentService.stripe'

// シングルトンインスタンスの管理
class Container {
  private static instances = new Map<string, any>()

  static getUserRepository(): UserRepository {
    const key = 'UserRepository'
    if (!this.instances.has(key)) {
      this.instances.set(key, new UserRepositoryPrisma())
    }
    return this.instances.get(key)
  }

  static getPaymentService(): PaymentService {
    const key = 'PaymentService'
    if (!this.instances.has(key)) {
      this.instances.set(key, new PaymentServiceStripe())
    }
    return this.instances.get(key)
  }

  // テスト用: 実装を差し替える
  static override<T>(key: string, instance: T): void {
    this.instances.set(key, instance)
  }

  // テスト用: コンテナをリセット
  static reset(): void {
    this.instances.clear()
  }
}

export { Container }
```

### 4.2 Handler実装パターン

```ts
// src/lib/server/features/user/command/record-login/handler.ts
import { Container } from '../../../shared/container'
import type { RecordLoginInput } from './core'

export async function recordLogin(input: RecordLoginInput) {
  // DIコンテナから実装を取得
  const userRepository = Container.getUserRepository()
  
  // ビジネスロジック
  return await userRepository.createLoginRecord(/* ... */)
}
```

### 4.3 ページルート実装パターン（推奨）

```ts
// src/routes/admin/user/+page.server.ts
import { requireAdmin } from '$lib/server/auth'
import { listAdminUsers } from '$lib/server/features/admin/query/list-admin-users/handler'
import { createAdminUser } from '$lib/server/features/admin/command/create-admin-user/handler'
import type { PageServerLoad, Actions } from './$types'

export const load: PageServerLoad = async (event) => {
  await requireAdmin(event)
  const users = await listAdminUsers()
  return { users }
}

export const actions: Actions = {
  create: async (event) => {
    await requireAdmin(event)
    const formData = await event.request.formData()
    const user = await createAdminUser({
      email: formData.get('email') as string,
      name: formData.get('name') as string
    })
    return { success: true, user }
  }
}
```

### 4.4 APIルート実装パターン（特殊ケースのみ）

```ts
// src/routes/api/lineworks/callback/+server.ts
import type { RequestHandler } from './$types'

export const POST: RequestHandler = async ({ request }) => {
  // Webhookの署名検証
  const signature = request.headers.get('x-works-signature')
  // ... 外部システムからのコールバック処理
  return new Response('OK', { status: 200 })
}
```

### 4.5 Adapter(Service)


#### インターフェイス
必ずportにInterfaceを置く

```ts
// src/lib/server/shared/port/service/discordService.ts

export interface DiscordService {
  // チャンネル情報の取得
  getChannel(channelId: string): Promise<DiscordChannelData | null>
  getChannels(): Promise<DiscordChannelData[]>

  // メッセージの取得
  getMessage(messageId: string): Promise<DiscordMessageData | null>
  getChannelMessages(channelId: string, limit?: number): Promise<DiscordMessageData[]>
  getRecentMessages(limit?: number): Promise<DiscordMessageData[]>

  // 同期関連
  syncChannelData(): Promise<{ synced: number; errors: string[] }>
  syncMessageData(channelId: string, limit?: number): Promise<{ synced: number; errors: string[] }>
  
  // 接続テスト
  testConnection(): Promise<boolean>
}

```

#### 実装
実装はadapter以下に置く。必要に応じてMockも作成する。

```ts
// src/lib/server/adapter/service/discord.service.ts
export class DiscordServicePrisma implements DiscordService {
  private discordBotToken: string;

  constructor() {
    this.discordBotToken = process.env.DISCORD_BOT_TOKEN || '';
    if (!this.discordBotToken) {
      throw new Error('DISCORD_BOT_TOKEN environment variable is required');
    }
  }

  async getChannelMessages(channelId: string, limit = 50): Promise<DiscordMessageData[]> {
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
        headers: {
          'Authorization': `Bot ${this.discordBotToken}`,
          'Content-Type': 'application/json'
        }
      });
}
```

### 4.6 スケジュール実行（cron）実装パターン

```ts
// src/lib/server/entrypoint/cron.ts
import { cleanupExpiredSessions } from '../features/auth/command/cleanup-expired-sessions/handler'
import { sendDailyReport } from '../flows/daily-report/handler'
import cron from 'node-cron'

// 毎時0分に期限切れセッションをクリーンアップ
cron.schedule('0 * * * *', async () => {
  console.log('Running expired session cleanup...')
  try {
    const result = await cleanupExpiredSessions()
    console.log(`Cleaned up ${result.count} expired sessions`)
  } catch (error) {
    console.error('Failed to cleanup sessions:', error)
  }
})

// 毎日午前9時にレポートを送信
cron.schedule('0 9 * * *', async () => {
  console.log('Sending daily report...')
  try {
    await sendDailyReport()
    console.log('Daily report sent successfully')
  } catch (error) {
    console.error('Failed to send daily report:', error)
  }
})

// プロセス終了時のクリーンアップ
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...')
  process.exit(0)
})
```

### 4.7 CLI実装パターン

```ts
// src/lib/server/entrypoint/cli.ts
import { createAdminUser } from '../features/admin/command/create-admin-user/handler'
import { reindexSearchData } from '../features/search/command/reindex-data/handler'

const command = process.argv[2]
const args = process.argv.slice(3)

async function main() {
  switch (command) {
    case 'create-admin':
      const [email, name] = args
      if (!email || !name) {
        console.error('Usage: cli.ts create-admin <email> <name>')
        process.exit(1)
      }
      const user = await createAdminUser({ email, name })
      console.log('Admin user created:', user)
      break

    case 'reindex':
      console.log('Starting search index rebuild...')
      const result = await reindexSearchData()
      console.log(`Reindexed ${result.count} documents`)
      break

    default:
      console.error('Unknown command:', command)
      console.error('Available commands: create-admin, reindex')
      process.exit(1)
  }
}

main().catch(error => {
  console.error('Command failed:', error)
  process.exit(1)
})
```

---

## 5. テスト戦略

| 階層             | テスト種類     | 特徴                    |
| -------------- | --------- | --------------------- |
| core/          | ユニット      | モック不要。DB/IO を使わない     |
| command/query/ | ユニット      | Container.override()でモック注入 |
| flows/         | 統合 or E2E | 実際の command/query を結合 |
| adapter/       | 契約テスト     | モックサーバで外部 API を stub  |
| entrypoint/    | 統合         | 実際のhandler呼び出しを検証     |


## 6. CI ルール

1. **型チェック**: Prisma スキーマ変更後 `bun run db:generate` を必ず走らせる。
2. **依存監視**: `eslint-plugin-boundaries` で以下を禁止:
   - features → adapter 直 import
   - features/<DomainA> → features/<DomainB> のクロスドメイン依存
   - _prefix付きcommand/queryのfeature外からの呼び出し
3. **行数監視**: `handler.ts` は 200 行、`core/*.ts` は 300 行を閾値とし超過で警告。

---

## 7. よくある質問（FAQ）

**Q. なぜ flow を command/query と同じ features に置かない？**
A. Flow はドメイン横断のため別階層に切り離すことで、依存方向を一目で把握できます。

**Q. Adapter のテストは？**
A. 外部サービスに対しては契約テスト (pact)、DB は Testcontainer で e2e を行います。

**Q. いつ /api/ ルートを使うべき？**
A. webhook、外部アプリ（モバイル、WOFF等）、サードパーティ連携のみ。管理画面などの通常のWebページは +page.server.ts を使用。

**Q. 既存の /api/admin/ エンドポイントはどうすべき？**
A. 段階的に対応する +page.server.ts へ移行。新規機能は最初から +page.server.ts で実装。

**Q. なぜ entrypoint/ にapi.tsを置かない？**
A. APIエンドポイントはSvelteKitのroutes/api/で管理すべきで、entrypointは非HTTPのエントリーポイント（cron、cli）専用です。

**Q. DIコンテナはいつ使うべき？**
A. adapter実装の差し替えが必要な場合（テスト、環境別設定）に使用。単純なケースでは過度な抽象化を避けます。

**Q. _prefixのcommand/queryはどこから呼べる？**
A. 同一feature内の他のcommand/queryからのみ。flows、entrypoint、routesからの直接呼び出しは禁止です。

**Q. features/user から features/payment の機能を使いたい場合は？**
A. 直接importは禁止。flows/user-payment/handler.ts を作成し、そこで両ドメインのcommand/queryを組み合わせます。

**Q. 複数のfeatureで使う共通の型はどこに置く？**
A. shared/types/ に配置。ただし、ドメイン固有の型は各feature内に留め、真に共通な型のみを共有します。

---

## 8. Onboarding 5 ステップ

1. `src/features/<domain>/core/` を 3 ファイル読んでドメイン知識を把握。
2. `command/<sample>/handler.ts` を追って副作用パターンを学習。
3. 新規小さな Query を追加 → MR 提出。
5. CI で通るまで修正し、レビュープロセスを体験。

## 9. 実装手順
### 9-1. 新規開発の場合（ゼロからの設計）

全くゼロからの新規開発では、実装前に設計フェーズを重視し、間違いを防ぎつつ最小限のコードで進めるのが効果的です。Domain（ドメイン）から始め、Port（抽象インターフェイス）を明確に定義してから実装に移るアプローチをおすすめします。これで依存方向が崩れにくく、拡張しやすくなります。ドキュメント作成を並行します。


#### ステップ1: ドメインリスト作成
- **目的**: アプリ全体のドメインを洗い出し、依存関係を考慮した基盤を築く。
- **手順**:
  - 要件からドメインリストを列挙（例: user, payment）。各ドメインの概要と相互依存をテキストで記述。
  - ドキュメント作成: `.knowledge/domains.md`を作成。ドメインリストを表形式でまとめる（ドメイン名 | 概要 | 依存ドメイン）。
- **設計Tips**: Flowが必要な横断部分をここで特定（例: user-payment flow）。

#### ステップ2: 全体設計の計画とドキュメント基盤作成
- **目的**: 設計の青写真を描き、ガイドラインを文書化。すべてのDomainとFlowをまとめて定義。
- **手順**:
  - 要件洗い出し: アプリの目的を明確に。
  - ドキュメント作成: `.knowledge/architecture.md`を作成。ディレクトリ構成の全体図とアーキテクチャ原則をベースに最小版を作成。
    - **おすすめ内容**:
      - **ディレクトリ構造**: Markdownでツリー図。すべてのfeatures/<Domain>とflows/を含む。
      - **アーキテクチャ原則**: 表でレイヤ責務と依存方向。
      - **ドメイン概要**: テキストで全ドメインを記述（例: userドメイン: ユーザー作成・クエリ）。
      - **命名規則**: 抜粋（例: core/は純粋関数のみ）。
  - features/とflows/の構成図作成: 全ドメインとFlowをまとめてツリー図を作成（テキストベース）。これで構造レビューがやりやすい。
    - 例 (userドメイン):
      ```
      src/features/user/
      ├── core/
      │   └── user.ts
      ├── command/
      │   └── create-user/
      │       ├── core.ts
      │       └── handler.ts
      └── query/
          └── get-user/
              ├── core.ts
              └── handler.ts
      ```
    - 例 (flows/):
      ```
      src/flows/
      └── user-payment/
          └── handler.ts
      ```
    - 例 (shared/port/):
      ```
      src/shared/port/
      ├── repository/
      │   └── userRepository.ts
      └── service/
          └── paymentService.ts
      ```
  - Domainスケッチ: 全core/のエンティティと関数をドキュメントに記す。
  - command/query/とflows/設計: 全Domainのcoreとshared/portを基にUseCaseを組み合わせ。handlerで直接インスタンス。複数ドメインのflowsをここで設計（2つ以上結合時）。
  - ドキュメント更新: `docs/usecases.md`にシーケンス（テキストで「入力 → core → adapter」）。
    - **おすすめ内容**:
      - **UseCaseカタログ**: 表 (コマンド名 | 入力型 | 出力型 | 依存Port | ルール)。
      - **flows判断**: 依存関係を記述。
- **設計Tips**: Portを仮定義。メソッドを最小に。ドキュメントにPortの役割を明記。flowsは最小限。


#### ステップ3: Domain駆動でcore/とport/の設計
- **目的**: 全Domainからportのインターフェイスを決定。依存方向を明確に。
- **手順**:
  - core/設計: Prismaスキーマを最小定義。全core/<Domain>.tsをスケッチ。
  - port/設計: coreのニーズからインターフェイス導出（例: createメソッドだけ）。shared/port/に集約配置。
  - ドキュメント更新: `docs/interfaces.md`を作成。Portのコードスニペットと理由を記述。
    - **おすすめ内容**:
      - **Portカタログ**: 表 (メソッド名 | 入力 | 出力 | 目的)。
      - **依存フロー**: テキストで「core → port → adapter」と記述。
- **例コード** (port/):
  ```ts
  // src/lib/server/shared/port/repository/userRepository.ts
  export interface UserRepository {
    create(user: { name: string }): Promise<{ id: string; name: string }>;
  }
  ```
- **設計Tips**: interface推奨。不変条件はcoreで保証。


#### ステップ3.5: 設計レビューとイテレーション
- **目的**: ステップ1-3の設計を自己反省し、不備を修正。完璧でない場合に繰り返しを入れる。
- **手順**:
  - レビュー: core/とport/の設計を振り返り、追加の関数やファイルが必要か確認（例: 新たなメソッドが判明したらportを更新）。
  - ドキュメント確認: 構成図やカタログに漏れがないかチェック。必要に応じてステップ2に戻り、ドメイン概要やツリー図を修正。
  - イテレーション: 不備があれば繰り返し（例: 1-2回）。これで一撃完璧でなくても調整可能。
- **設計Tips**: 依存方向の違反がないか確認。チームレビューも推奨。
。

#### ステップ4: adapter/の実装設計とコード化
- **目的**: Portに基づき実装を具体化。
- **手順**:
  - adapter/設計: Portを実装（例: Prisma）。カプセル化。
  - ドキュメント更新: `docs/adapters.md`に実装詳細とテスト戦略。
    - **おすすめ内容**:
      - **Adapterマニュアル**: コードスニペットとエラー処理。
      - **Mockガイド**: サンプルコード。
- **例コード** (adapter/):
  ```ts
  // src/lib/server/adapter/repository/userRepository.prisma.ts
  import { PrismaClient } from '@prisma/client';
  import { UserRepository } from '../../shared/port/repository/userRepository';

  const prisma = new PrismaClient();

  export class UserRepositoryPrisma implements UserRepository {
    async create(user: { name: string }): Promise<{ id: string; name: string }> {
      return prisma.user.create({ data: user });
    }
  }
  ```
- **設計Tips**: ドメイン語彙を可能な限り避ける。

#### ステップ5: 全体接続・テスト・ドキュメント完成
- **目的**: 検証とドキュメント締め。
- **手順**:
  - interfaces/entrypoints接続。
  - テスト設計: `docs/tests.md`作成。
  - 最終ドキュメント: FAQ追加（例: Port設計の理由）。
- **設計Tips**: CIルール記載。


### 9-2. 機能追加/拡張の場合（既存プロジェクトへの実装）

既存プロジェクトに機能を追加する場合、依存方向を崩さないよう「内側（core/policy）から外側（adapter/interfaces）へ」実装を進めます。まずDB変更やビジネスロジック（features/flows）を固め、次に抽象層（port）と具体実装（adapter）を繋ぎ、最後にテストとクライアント側/エンドポイントを追加。途中でドキュメント更新とレビューを挟むことで、品質を確保します。

#### ステップ1: データベース変更の確認とPrismaスキーマ編集（必要時）
- **目的**: DB構造を更新し、型安全性を確保。変更がない場合、このステップをスキップ。
- **手順**:
  - 要件からDB変更が必要か確認（例: 新カラム追加、テーブル作成）。
  - Prismaスキーマ（prisma/schema.prisma）を編集（例: modelにフィールド追加）。
  - `bun run db:generate` を実行して型ファイルを生成。
  - `bun run db:reset` でDBをリセット、または本番環境では `bun run db:deploy` でマイグレーションを適用。
  - ドキュメント更新: `.knowledge/domains.md` や `docs/interfaces.md` にDB変更を反映（例: 新フィールドの説明）。
- **対象ファイル**: prisma/schema.prisma
- **Tips**: Readonly型としてcore/で再利用。不変条件はcore/のFactoryで保証。CIルールで型チェックを強制。

#### ステップ2: features/ と flows/ の実装（ビジネスロジック基盤）
- **目的**: ドメインの純粋関数とUseCaseを先に実装。これがないと後続のport/adapterが不明瞭になる。
- **手順**:
  - core/ : 純粋関数/エンティティを実装（副作用ゼロ）。PrismaモデルをReadonlyで再利用。不変条件をFactory関数で保証。
  - policy/ : 複数エンティティの規則を実装（例: canApplyCoupon）。単純なものはcore/に統合。
  - command/query/ : core.tsで入力検証/計算（純粋）、handler.tsでロジック概要（副作用は後で）。1ファイル200行超え時はcore/へ抽出。
  - flows/ : 複数ドメインのオーケストレーション（2つ以上のcommand/query結合時）。ビジネス分岐20行超え時はpure関数抽出。
  - ドキュメント更新: `docs/usecases.md` にUseCaseカタログ追加（表形式: コマンド名 | 入力型 | 出力型 | 依存Port）。
- **対象ファイル**:
  - src/features/<Domain>/core/<Domain>.ts
  - src/features/<Domain>/policy/<Policy>.ts
  - src/features/<Domain>/command/<Command>/{core.ts, handler.ts}
  - src/features/<Domain>/query/<Query>/{core.ts, handler.ts}
  - src/flows/<Flow>/handler.ts
- **Tips**: 依存方向を守る（core → policy → command/query → flows）。handler.tsではportを仮使用（後で実装）。

#### ステップ3: port/ の抽象インターフェイス修正/実装
- **目的**: 外部との境界面を定義。features/のニーズから導出。
- **手順**:
  - core/policy/command/queryのニーズからinterfaceを定義/修正（例: 新メソッド追加）。
  - メソッドを最小限に（入力/出力型明確）。
  - ドキュメント更新: `docs/interfaces.md` にPortカタログ追加（表: メソッド名 | 入力 | 出力 | 目的）。
- **対象ファイル**: src/lib/server/shared/port/{repository,service}/<Port>.ts
- **Tips**: interface推奨。adapterの実装前にportを固めることで、依存逆転を実現。

#### ステップ4: adapter/ の具体クラス実装
- **目的**: 外部サービス/DBの実装をカプセル化。portを実装。
- **手順**:
  - repository/ : DBアクセス（Prisma経由）。クラスで定義、query()/invoke()メソッド公開。
  - service/ : 外部API/LLM呼び出し。リトライ/サーキットブレーカ内蔵。ドメイン語彙避け、mapper挟む。
  - Mock作成（テスト用）。
  - handler.tsで直接インスタンス使用（例: const repo = new UserRepositoryPrisma()）。
  - ドキュメント更新: `docs/adapters.md` に実装詳細/エラー処理追加。
- **対象ファイル**:
  - src/adapter/repository/<Repository>.prisma.ts
  - src/adapter/service/<Service>.ts
- **Tips**: portを実装する形で依存方向を守る。外部依存（env変数など）確認。

#### ステップ5: routes/ の実装（ページルート・APIエンドポイント）
- **目的**: SvelteKitのルーティングを実装。基本はページルート、特殊ケースのみAPI。
- **手順**:
  - **ページルート（推奨）**: routes/[page]/+page.server.ts でload関数とactionsを実装。
    - load: ページ表示用データ取得
    - actions: フォーム送信処理
  - **APIルート（特殊ケースのみ）**: routes/api/**/+server.ts でwebhook等を実装。
    - webhook、外部アプリ連携、サードパーティAPI連携のみ
  - 認証が必要な場合は `$lib/server/auth` から `requireAuth` や `requireAdmin` をインポート。
  - handler/flowsを直接インポートして使用（flows/優先）。
  - ドキュメント更新: `docs/usecases.md` にシーケンス追加。
- **対象ファイル**:
  - src/routes/**/+page.server.ts（ページルート）
  - src/routes/api/**/+server.ts（APIルート - 特殊ケースのみ）
  - src/lib/server/auth.ts（認証ヘルパー等）
- **Tips**: ページルートではPageServerLoad、Actions型を使用。APIルートではRequestHandler型を使用。

#### ステップ6: クライアント側ページ実装（UI）
- **目的**: SvelteKitのフォームアクションを活用したUI実装。
- **手順**:
  - **+page.svelte**: ページコンポーネントでUI実装。
    - フォーム送信: `use:enhance` を使用したプログレッシブエンハンスメント
    - データ表示: load関数から受け取ったデータを表示
  - **特殊ケースのみ**: 外部API呼び出しが必要な場合（WOFFアプリ等）
    - client/helper.ts でAPI呼び出しヘルパーを実装
  - ドキュメント更新: `.knowledge/domains.md` にクライアント側概要追加。
- **対象ファイル**:
  - src/routes/**/+page.svelte（ページコンポーネント）
  - src/lib/features/<Domain>/client/<Helper>.ts（特殊ケースのみ）
- **Tips**: 基本はフォーム送信。SPAライクな動作が必要な特殊ケースのみAPI呼び出し。

#### ステップ7: テスト実装
- **目的**: 各レイヤの品質確保。アーキテクチャのテスト戦略に従う。
- **手順**:
  - core/ : ユニットテスト（モック不要、副作用なし）。
  - command/query/ : ユニット（portダミー注入）。
  - flows/ : 統合/E2E（実際結合）。
  - adapter/ : 契約テスト（モックサーバ/Testcontainer）。
  - クライアント側: UIテスト（例: Vitest/Jest）。
  - カバレッジ確認（80%以上目安）。
  - ドキュメント更新: `docs/tests.md` にテストケース追加。
- **対象ファイル**: tests/ 配下（例: core.test.ts）
- **Tips**: エッジケース（無効入力、タイムアウト）含む。CIで自動実行。

#### ステップ8: レビュー/イテレーションとCIチェック（オプション）
- **目的**: 不備修正。全体整合性確認。
- **手順**:
  - 自己レビュー: 依存方向/行数チェック（eslint-plugin-boundaries使用）。
  - チームレビュー: MR提出。
  - CI実行: 型チェック/依存監視/行数警告。
  - イテレーション: 不備あればステップ2-7に戻る。
  - ドキュメント完成: FAQ追加（例: 新機能のQ&A）。
- **Tips**: Onboarding 5ステップを参考に新人向け説明追加。

#### ステップ9: デプロイ/運用準備（オプション）
- **目的**: 本番適用。
- **手順**:
  - 環境変数確認（adapter依存）。
  - マイグレーション適用。
  - 監視設定（エラーログなど）。
- **Tips**: ロールバック計画をドキュメントに記載。
--- 



</architecture>

<implementation_report_template>
# {ファイル名} 実装レポート
実行モデル名: {実行モデル名 例: claude-4-sonnet, claude-4-opus}

## サマリー
{⭕️完了、⚠️一部懸念、❌不足あり}

{結論: 1文で概要。例: 「UI修正を実施したが、エラー出し分けに懸念残る。」}

- 主な修正点: {箇条書き、2-3点}
- 検証結果: {👍️同一達成、👎️一部差異あり。簡易説明}

## 懸念点と実装不足の可能性
{ここをメインに。箇条書きで具体的に指摘}
- {懸念1: 例: 「ローディング動作のエッジケース（低速ネットワーク時）が未テスト。性能差異の可能性あり。」}
- {懸念2: 例: 「エラーメッセージの出し分けがZenstackの固定エラーに対応しきれていない。カスタム処理追加を検討。」}
- {懸念3: 例: 「アクセシビリティ属性の漏れ。ARIA-labelが旧プロジェクトと一致しない可能性。」}
- {なしの場合: 「特になし」}


## 影響ページ

### {影響ページ名}: {影響ページパス}

#### ページ説明
{ページの役割や依存コンポーネント、例: 「ユーザー一覧ページ。依存: UserListComponent, API: /api/users」}

#### 以前の動作
{旧プロジェクト（Djangoベース）の詳細な動作フローを記載。例:
- ページロード時: APIからユーザー一覧を取得し、テーブル表示。
- 検索機能: 入力でフィルタリング、リアルタイム更新。
- エラー時: ネットワークエラーでアラート表示。
}

#### 期待する動作
{新プロジェクト（Next.js/Zenstack）での理想動作、UI/機能の同一性を強調。例:
- ページロード時: getServerSidePropsでデータフェッチ、旧と同じテーブル構造で表示。
- 検索機能: useStateで状態管理、フィルタリングロジックを旧と同一に。
- エラー時: Zenstackの固定エラーをカスタム処理で旧メッセージに置き換え、表示位置/スタイル同一。
}
{オプション: 差異許容点、例: 「APIレスポンス構造が変わるが、UI出力は同一。」}

#### 確認結果
{
  | 項目カテゴリ | 結果（Passed/Failed） | コメント・残課題 |
|--------------|----------------------|------------------|
| UI           | {Passed/Failed}      | {例: クラス名差異あり} |
| 機能         | {Passed/Failed}      | {例: 検索ロジック同一} |
| エラー処理   | {Passed/Failed}      | {例: メッセージ差異あり} |
| ...          | ...                  | ...              |
}



## 影響ドメイン
### {影響ドメイン名}

- 関連機能: {例: 認証、ユーザー管理、データ取得 など}
- 依存システム・外部API: {例: 社内認証基盤、外部決済API など}
- 影響範囲: {例: 管理画面全体、特定モジュールのみ など}
- 懸念点・注意事項: {例: 既存データとの互換性、他機能への波及リスク など}
- その他: {必要に応じて記載}

{複数ドメインがある場合は、上記を繰り返し記載}

</implementation_report_template>


実装計画書: