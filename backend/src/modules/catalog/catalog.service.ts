import { PrismaClient, Prisma } from '@prisma/client';
import { AppError, notFound } from '../../common/errors/index';

const prisma = new PrismaClient();

export interface ServiceDto {
  id: string;
  name: string;
  category: string;
  baseFee: number;
  icon?: string | null;
  description?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(service: any): ServiceDto {
  return {
    id: service.id,
    name: service.name,
    category: service.category,
    baseFee: service.baseFee,
    icon: service.icon,
    description: service.description,
    isActive: service.isActive,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
  };
}

export async function listServices(): Promise<ServiceDto[]> {
  const services = await prisma.service.findMany({
    where: { isActive: true },
    orderBy: { category: 'asc' },
  });
  return services.map(toDto);
}

export async function getService(id: string): Promise<ServiceDto> {
  const service = await prisma.service.findUnique({ where: { id } });
  if (!service) {
    throw notFound('SERVICE_NOT_FOUND', 'Service not found');
  }
  return toDto(service);
}

export async function createService(input: any): Promise<ServiceDto> {
  const service = await prisma.service.create({
    data: {
      name: input.name,
      category: input.category,
      baseFee: input.baseFee,
      icon: input.icon,
      description: input.description,
    },
  });
  return toDto(service);
}

export async function updateService(id: string, input: any): Promise<ServiceDto> {
  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) {
    throw notFound('SERVICE_NOT_FOUND', 'Service not found');
  }

  const service = await prisma.service.update({
    where: { id },
    data: {
      name: input.name,
      category: input.category,
      baseFee: input.baseFee,
      icon: input.icon,
      description: input.description,
      isActive: input.isActive,
    },
  });
  return toDto(service);
}

export async function deleteService(id: string): Promise<void> {
  const existing = await prisma.service.findUnique({ where: { id } });
  if (!existing) {
    throw notFound('SERVICE_NOT_FOUND', 'Service not found');
  }

  await prisma.service.delete({ where: { id } });
}