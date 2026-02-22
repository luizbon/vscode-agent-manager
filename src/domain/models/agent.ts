import { IMarketplaceItem } from './marketplaceItem';

export interface Agent extends IMarketplaceItem {
    type: 'agent';
    // Add any specific agent fields here in the future
}
