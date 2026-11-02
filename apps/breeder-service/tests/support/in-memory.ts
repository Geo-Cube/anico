import type {
  Breeder,
  NewBreeder,
} from '../../src/modules/breeders/domain/breeder.js';

export function inMemoryBreeders() {
  const breeders = new Map<string, Breeder>();

  return {
    async provision(input: NewBreeder): Promise<Breeder> {
      const existing = breeders.get(input.breederId);

      if (existing) {
        return existing;
      }

      const breeder: Breeder = {
        breederId: input.breederId,
        firstName: input.firstName,
        lastName: input.lastName,
        emailAddress: input.emailAddress,
        breedingStationName: null,
        breedingStationNumber: null,
        isVerified: false,
        verificationRequest: null,
      };

      breeders.set(input.breederId, breeder);

      return breeder;
    },

    async findByBreederId(breederId: string): Promise<Breeder | null> {
      return breeders.get(breederId) ?? null;
    },
  };
}
