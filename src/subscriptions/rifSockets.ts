import EventEmitter from 'eventemitter3'
import {
  ITokenWithBalance,
  RifWalletServicesSocket,
} from '@rsksmart/rif-wallet-services'
import DeviceInfo from 'react-native-device-info'
import Config from 'react-native-config'
import { BigNumber, utils } from 'ethers'

import { ChainID } from 'lib/eoaWallet'
import { resetSocketState } from 'store/shared/actions/resetSocketState'
import { AppDispatch } from 'store/index'
import { abiEnhancer } from 'core/setup'
import { addOrUpdateBalances } from 'store/slices/balancesSlice'
import { TokenBalanceObject } from 'store/slices/balancesSlice/types'
import { UsdPricesState } from 'store/slices/usdPricesSlice'
import { getWalletSetting } from 'core/config'
import { SETTINGS } from 'core/types'
import { MMKVStorage } from 'storage/MMKVStorage'
import { getDefaultTokens } from 'shared/utils'

import { onSocketChangeEmitted } from './onSocketChangeEmitted'
import { Action, InitAction } from './types'

export const socketsEvents = new EventEmitter()

export enum SocketsEvents {
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',
}

interface RifSockets {
  address: string
  chainId: ChainID
  setGlobalError: (err: string) => void
  dispatch: AppDispatch
  usdPrices: UsdPricesState
  balances: Record<string, TokenBalanceObject>
}

const onSocketInit = (
  payload: InitAction['payload'],
  cb: (action: Action) => void,
) => {
  cb({ type: 'init', payload })
}

const cache = new MMKVStorage('txs')

export const rifSockets = ({
  address,
  chainId,
  dispatch,
  setGlobalError,
  usdPrices,
  balances,
}: RifSockets) => {
  console.log('⚙️ [rifSockets] Initializing socket logic...')
  console.log('📬 Wallet address:', address)
  console.log('🌐 Chain ID:', chainId)

  const onChange = onSocketChangeEmitted({
    dispatch,
    abiEnhancer,
    usdPrices,
    chainId,
    cache,
  })

  const rifWalletServicesSocket = new RifWalletServicesSocket(
    getWalletSetting(SETTINGS.RIF_WALLET_SERVICE_URL, chainId),
  )

  const connectSocket = () => {
    if (rifWalletServicesSocket.isConnected()) {
      rifWalletServicesSocket.disconnect()
      dispatch(resetSocketState())
    }

    console.log('♻️ [rifSockets] Cleaned up socketsEvents listeners.')
    socketsEvents.removeAllListeners()

    const defaultTokens = getDefaultTokens(chainId)
    const defaultTokensWithBalance = defaultTokens.map(t => {
      const tokenBalance = balances[t.contractAddress]
      return {
        ...t,
        logo: '',
        balance: tokenBalance?.balance ?? t.balance,
        usdBalance: tokenBalance?.usdBalance ?? t.usdBalance,
      } as ITokenWithBalance
    })

    dispatch(addOrUpdateBalances(defaultTokensWithBalance))
    console.log('💰 [rifSockets] Default tokens with balances dispatched.')

    rifWalletServicesSocket.removeAllListeners()
    console.log('🧹 [rifSockets] Removed all existing socket listeners.')

    rifWalletServicesSocket.on('init', async payload => {
      console.log(
        '📦 [rifSockets] Received "init" payload:',
        JSON.stringify(payload, null, 2),
      )

      const tokens = payload.tokens || []

      const logTokenBalance = (symbol: string) => {
        const token = tokens.find(
          t => t.symbol?.toLowerCase() === symbol.toLowerCase(),
        )

        if (token) {
          const balanceRaw = token.balance
          const decimals = token.decimals ?? 18
          let formattedBalance = '0'

          try {
            formattedBalance = utils.formatUnits(
              BigNumber.from(balanceRaw),
              decimals,
            )
          } catch (err) {
            console.warn(
              `⚠️ [rifSockets] Error al formatear balance de ${symbol}:`,
              err,
            )
          }

          console.log(`🔎 [rifSockets] Token ${symbol}:`)
          console.log(`   🔗 Address: ${token.contractAddress}`)
          console.log(`   💰 Balance (raw): ${balanceRaw}`)
          console.log(`   🏷️  Decimals: ${decimals}`)
          console.log(`   ✅ Balance (formatted): ${formattedBalance}`)
        } else {
          console.warn(
            `❌ [rifSockets] Token ${symbol} not found in init.tokens`,
          )
        }
      }

      logTokenBalance('tRIF')
      logTokenBalance('RBTC')

      onSocketInit(payload, onChange)
      console.log('🟢 [rifSockets] Socket INIT event received ✅')
    })

    rifWalletServicesSocket.on('change', onChange)

    try {
      const blockNumber = cache.get('blockNumber') || '0'
      console.log('🔌 [rifSockets] Attempting socket connection...')
      console.log('🧠 [rifSockets] Connecting with headers:', {
        'User-Agent': DeviceInfo.getUserAgentSync(),
        'x-trace-id': Config.TRACE_ID,
      })
      console.log('📦 [rifSockets] Starting from block:', blockNumber)

      rifWalletServicesSocket.connect(
        address,
        chainId,
        {
          'User-Agent': DeviceInfo.getUserAgentSync(),
          'x-trace-id': Config.TRACE_ID,
        },
        blockNumber,
      )

      console.log('✅ [rifSockets] Socket connection initiated.')
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error connecting to socket'
      console.error('❌ [rifSockets] Connection error:', msg)
      setGlobalError(msg)
    }
  }

  const disconnectSocket = () => {
    console.log('🔌 [rifSockets] Disconnecting socket...')
    rifWalletServicesSocket.disconnect()
  }

  socketsEvents.on(SocketsEvents.CONNECT, connectSocket)
  socketsEvents.on(SocketsEvents.DISCONNECT, disconnectSocket)

  console.log(
    '📣 [rifSockets] Socket event listeners set: CONNECT / DISCONNECT',
  )
}
