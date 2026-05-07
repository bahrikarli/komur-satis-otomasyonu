/* Stok eşiklerini kalıcı yapmak için migration */
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND name = N'EsikAlt')
BEGIN
    ALTER TABLE [komur].[dbo].[StokListesi] ADD [EsikAlt] DECIMAL(18,2) NULL;
END
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND type in (N'U'))
AND NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[komur].[dbo].[StokListesi]') AND name = N'EsikUst')
BEGIN
    ALTER TABLE [komur].[dbo].[StokListesi] ADD [EsikUst] DECIMAL(18,2) NULL;
END
GO

/* Opsiyonel: mevcut satırlar için örnek başlangıç eşikleri */
/*
UPDATE [komur].[dbo].[StokListesi]
SET EsikAlt = 20, EsikUst = 50
WHERE TakipEdilsinMi = 1 AND (EsikAlt IS NULL OR EsikUst IS NULL);
GO
*/
