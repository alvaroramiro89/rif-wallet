import EventEmitter from 'eventemitter3'
import {
  ITokenWithBalance,
  RifWalletServicesSocket,
} from '@rsksmart/rif-wallet-services'
import DeviceInfo from 'react-native-device-info'
import Config from 'react-native-config'

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
  console.log('🟢 [rifSockets] Socket INIT event received ✅')
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
    console.log('🔌 [rifSockets] Attempting socket connection...')

    if (rifWalletServicesSocket.isConnected()) {
      console.log(
        '🛑 [rifSockets] Socket already connected. Disconnecting first...',
      )
      rifWalletServicesSocket.disconnect()
      dispatch(resetSocketState())
    }

    const defaultTokens = getDefaultTokens(chainId)
    const defaultTokensWithBalance = defaultTokens.map(t => {
      const tokenBalance = balances[t.contractAddress]
      return {
        ...t,
        logo: '', // remove warning
        balance: tokenBalance?.balance ?? t.balance,
        usdBalance: tokenBalance?.usdBalance ?? t.usdBalance,
      } as ITokenWithBalance
    })

    dispatch(addOrUpdateBalances(defaultTokensWithBalance))
    console.log('💰 [rifSockets] Default tokens with balances dispatched.')

    rifWalletServicesSocket.removeAllListeners()
    console.log('🧹 [rifSockets] Removed all existing socket listeners.')

    rifWalletServicesSocket.on('init', async payload => {
      console.log('📦 [rifSockets] Received "init" payload:', payload)
      onSocketInit(payload, onChange)
    })

    rifWalletServicesSocket.on('change', payload => {
      console.log('📡 [rifSockets] Received "change" event:', payload)
      onChange(payload)
    })

    try {
      const blockNumber = cache.get('blockNumber') || '0'
      const headers = {
        'User-Agent': DeviceInfo.getUserAgentSync(),
        'x-trace-id': Config.TRACE_ID,
      }
      console.log('🧠 [rifSockets] Connecting with headers:', headers)
      console.log('📦 [rifSockets] Starting from block:', blockNumber)

      rifWalletServicesSocket.connect(address, chainId, headers, blockNumber)

      console.log('✅ [rifSockets] Socket connection initiated.')
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Error connecting to socket'
      console.error('❌ [rifSockets] Socket connection failed:', msg)
      setGlobalError(msg)
    }
  }

  const disconnectSocket = () => {
    console.log('🔌 [rifSockets] Disconnecting socket...')
    rifWalletServicesSocket.disconnect()
  }

  socketsEvents.removeAllListeners()
  console.log('♻️ [rifSockets] Cleaned up socketsEvents listeners.')

  socketsEvents.on(SocketsEvents.CONNECT, connectSocket)
  socketsEvents.on(SocketsEvents.DISCONNECT, disconnectSocket)

  console.log(
    '📣 [rifSockets] Socket event listeners set: CONNECT / DISCONNECT',
  )
}
